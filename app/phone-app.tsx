'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { Call, Device } from '@twilio/voice-sdk';
import { createClient } from '@/lib/supabase/client';
import { isValidE164, normalizeNumber } from '@/lib/calling';
import { parseContacts } from '@/lib/import-contacts';
import {
  PACKAGES,
  CUSTOM_MIN_MINUTES,
  CUSTOM_MAX_MINUTES,
  customPriceCents,
  formatPrice,
  formatDuration,
  ratePerMinCents,
} from '@/lib/pricing';
import { useTheme, type Theme } from '@/lib/use-theme';
import { SOUNDS, renderSfx, type SfxId } from '@/lib/soundboard';
import { buyTime, type BuyInput } from './actions/billing';
import { signOut } from './login/actions';
import { deleteAccount } from './actions/account';

type Tab = 'contacts' | 'keypad' | 'recents' | 'account';
type Contact = { id: string; name: string; phone_number: string; is_favorite?: boolean };
type CallRow = { to_number: string; seconds: number; created_at: string };
type CallState = 'idle' | 'connecting' | 'live' | 'ended';
type Quality = 'good' | 'poor';

type Props = {
  userId: string;
  email: string;
  initialBalanceSeconds: number;
  canCall: boolean;
  testTopupEnabled: boolean;
};

const LOW_TIME_SECONDS = 120;

const AVATAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-pink-500',
];
function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '#';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function prettyNumber(n: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : n;
}
function formatDial(v: string): string {
  if (v.startsWith('+')) return v;
  const d = v.replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}${d.length > 10 ? ' ' + d.slice(10) : ''}`;
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};
function useDtmf() {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback((key: string) => {
    const pair = DTMF[key];
    if (!pair) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!ctxRef.current) ctxRef.current = new AC();
      const ctx = ctxRef.current;
      const t = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      gain.connect(ctx.destination);
      for (const f of pair) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        o.connect(gain);
        o.start(t);
        o.stop(t + 0.16);
      }
    } catch {
      /* ignore */
    }
  }, []);
}

// Soundboard: play a synthesized effect locally AND splice it into the live call
// so the other side hears it too. We mix the caller's mic through a Web Audio
// graph and hand the mixed track back to Twilio's outgoing sender. The call's
// audio path is left untouched until the user actually taps a sound (a user
// gesture), so ordinary calls carry no risk from this feature.
function useSoundboard(getCall: () => Call | null) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mixRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const monitorRef = useRef<GainNode | null>(null);
  const micRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wiredRef = useRef(false);

  const ensure = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const monitor = ctx.createGain();
      monitor.gain.value = 0.45;
      monitor.connect(ctx.destination);
      ctxRef.current = ctx;
      mixRef.current = ctx.createMediaStreamDestination();
      monitorRef.current = monitor;
      // A backgrounded tab can suspend the context; resume so the mixed mic
      // keeps flowing to the other side when the user returns.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => {});
      });
    }
    return ctxRef.current;
  }, []);

  const wire = useCallback((ctx: AudioContext) => {
    if (wiredRef.current || !mixRef.current) return;
    const call = getCall();
    const local = call?.getLocalStream();
    if (!call || !local || local.getAudioTracks().length === 0) return;
    try {
      micRef.current = ctx.createMediaStreamSource(local);
      micRef.current.connect(mixRef.current);
      // Internal-but-typed Twilio method: swap the outgoing track for our mix.
      call._setInputTracksFromStream(mixRef.current.stream);
      wiredRef.current = true;
    } catch {
      micRef.current?.disconnect();
      micRef.current = null;
    }
  }, [getCall]);

  const play = useCallback(async (id: SfxId) => {
    const ctx = ensure();
    try { await ctx.resume(); } catch { /* ignore */ }
    wire(ctx);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    if (monitorRef.current) out.connect(monitorRef.current);
    if (wiredRef.current && mixRef.current) out.connect(mixRef.current);
    renderSfx(ctx, out, id);
  }, [ensure, wire]);

  // Called when a call ends: drop the old mic source so the next call re-wires.
  const detach = useCallback(() => {
    micRef.current?.disconnect();
    micRef.current = null;
    wiredRef.current = false;
  }, []);

  return { play, detach };
}

const NAV: { key: Tab; label: string }[] = [
  { key: 'keypad', label: 'Keypad' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'recents', label: 'Recents' },
  { key: 'account', label: 'Account' },
];

export function PhoneApp({ userId, email, initialBalanceSeconds, canCall, testTopupEnabled }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const dtmf = useDtmf();

  const [tab, setTab] = useState<Tab>('keypad');
  const [balanceSeconds, setBalanceSeconds] = useState(initialBalanceSeconds);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recents, setRecents] = useState<CallRow[]>([]);
  const [keypad, setKeypad] = useState('');
  const [sheet, setSheet] = useState<{ mode: 'add' | 'edit'; contact?: Contact; prefill?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasTime = balanceSeconds > 0;

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningsRef = useRef<Set<string>>(new Set());
  const [deviceReady, setDeviceReady] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callPeer, setCallPeer] = useState<{ name: string; number: string }>({ name: '', number: '' });
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<Quality>('good');
  const [reconnecting, setReconnecting] = useState(false);

  const getCall = useCallback(() => callRef.current, []);
  const { play: playSound, detach: detachSoundboard } = useSoundboard(getCall);

  useEffect(() => {
    if (!canCall) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/token');
        if (!res.ok) return;
        const { token } = await res.json();
        const { Device } = await import('@twilio/voice-sdk');
        if (cancelled) return;
        const device = new Device(token, { logLevel: 1 });
        device.on('error', () => {});
        // Keep long sessions alive: refresh the token before it expires.
        device.on('tokenWillExpire', async () => {
          try {
            const r = await fetch('/api/token');
            if (r.ok) device.updateToken((await r.json()).token);
          } catch { /* ignore */ }
        });
        await device.register();
        if (cancelled) return;
        deviceRef.current = device;
        setDeviceReady(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [canCall]);

  const loadContacts = useCallback(async () => {
    const withFav = await supabase.from('contacts').select('id,name,phone_number,is_favorite').order('name', { ascending: true });
    const data = withFav.error
      ? (await supabase.from('contacts').select('id,name,phone_number').order('name', { ascending: true })).data
      : withFav.data;
    const rows = (data ?? []) as Contact[];
    setContacts(rows.map((r) => ({ id: r.id, name: r.name, phone_number: r.phone_number, is_favorite: !!r.is_favorite })));
  }, [supabase]);

  const loadRecents = useCallback(async () => {
    const { data } = await supabase
      .from('calls')
      .select('to_number,seconds,created_at')
      .order('created_at', { ascending: false })
      .limit(25);
    setRecents(data ?? []);
  }, [supabase]);

  const refreshBalance = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('balance_seconds').eq('id', userId).single();
    if (data) setBalanceSeconds(data.balance_seconds);
  }, [supabase, userId]);

  useEffect(() => {
    loadContacts();
    loadRecents();
  }, [loadContacts, loadRecents]);

  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(''), 4000);
    return () => clearTimeout(t);
  }, [importMsg]);

  const startTimer = () => {
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const placeCall = useCallback(
    async (rawNumber: string, name: string) => {
      if (!canCall) return;
      if (!hasTime) {
        setTab('account');
        return;
      }
      const number = normalizeNumber(rawNumber);
      if (!deviceRef.current || !isValidE164(number)) return;

      setMuted(false);
      setQuality('good');
      setReconnecting(false);
      warningsRef.current.clear();
      setCallPeer({ name: name || prettyNumber(number), number });
      setCallState('connecting');

      const call = await deviceRef.current.connect({ params: { To: number } });
      callRef.current = call;

      call.on('accept', () => {
        setCallState('live');
        startTimer();
      });
      call.on('warning', (w: string) => {
        warningsRef.current.add(w);
        setQuality('poor');
      });
      call.on('warning-cleared', (w: string) => {
        warningsRef.current.delete(w);
        if (warningsRef.current.size === 0) setQuality('good');
      });
      call.on('reconnecting', () => setReconnecting(true));
      call.on('reconnected', () => setReconnecting(false));

      const onEnd = () => {
        stopTimer();
        detachSoundboard();
        callRef.current = null;
        setReconnecting(false);
        setCallState('ended');
        loadRecents();
        refreshBalance();
        setTimeout(() => setCallState('idle'), 1100);
      };
      call.on('disconnect', onEnd);
      call.on('cancel', onEnd);
      call.on('reject', onEnd);
    },
    [canCall, hasTime, loadRecents, refreshBalance, detachSoundboard],
  );

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
  }, []);
  const toggleMute = useCallback(() => {
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }, [muted]);
  const sendDigit = useCallback((d: string) => { callRef.current?.sendDigits(d); }, []);

  // Keyboard support on the keypad.
  useEffect(() => {
    if (tab !== 'keypad' || callState !== 'idle' || sheet || settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (/^[0-9*#]$/.test(e.key)) { setKeypad((v) => v + e.key); dtmf(e.key); }
      else if (e.key === '+') setKeypad((v) => v + '+');
      else if (e.key === 'Backspace') setKeypad((v) => v.slice(0, -1));
      else if (e.key === 'Enter' && keypad) placeCall(keypad, '');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, callState, sheet, settingsOpen, keypad, placeCall, dtmf]);

  const toggleFavorite = async (c: Contact) => {
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_favorite: !x.is_favorite } : x)));
    const { error } = await supabase.from('contacts').update({ is_favorite: !c.is_favorite }).eq('id', c.id);
    if (error) setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_favorite: c.is_favorite } : x)));
  };

  const saveContact = async (name: string, number: string): Promise<string | null> => {
    if (sheet?.mode === 'edit' && sheet.contact) {
      const { error } = await supabase.from('contacts').update({ name, phone_number: number }).eq('id', sheet.contact.id);
      if (error) return error.message;
    } else {
      const { error } = await supabase.from('contacts').insert({ user_id: userId, name, phone_number: number });
      if (error) return error.message;
    }
    setSheet(null);
    loadContacts();
    setTab('contacts');
    return null;
  };

  const importContacts = async (file: File) => {
    setImportMsg('Reading…');
    try {
      const parsed = parseContacts(await file.text(), file.name);
      if (!parsed.length) return setImportMsg('No valid phone numbers found in that file.');
      const existing = new Set(contacts.map((c) => c.phone_number));
      const toInsert = parsed
        .filter((p) => !existing.has(p.phone))
        .map((p) => ({ user_id: userId, name: p.name, phone_number: p.phone }));
      if (!toInsert.length) return setImportMsg('Those contacts are already saved.');
      const { error } = await supabase.from('contacts').insert(toInsert);
      if (error) return setImportMsg(error.message);
      setImportMsg(`Imported ${toInsert.length} contact${toInsert.length > 1 ? 's' : ''}.`);
      loadContacts();
      setTab('contacts');
    } catch {
      setImportMsg('Could not read that file.');
    }
  };

  const callableNow = canCall && deviceReady && hasTime;
  const callDisabledReason = !canCall
    ? "Calling isn't enabled for your account yet."
    : !hasTime
      ? 'Buy call time to start calling.'
      : !deviceReady
        ? 'Connecting…'
        : '';

  const titles: Record<Tab, string> = { contacts: 'Contacts', keypad: 'Keypad', recents: 'Recents', account: 'Account' };

  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/60 p-5 backdrop-blur md:flex">
        <div className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PhoneBadge />
            <span className="text-xl font-bold tracking-tight">CallDad</span>
          </div>
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="press grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-foreground/5 hover:text-foreground">
            <GearIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 rounded-2xl bg-gradient-to-br from-accent to-emerald-700 p-4 text-white shadow-md shadow-emerald-900/10">
          <p className="text-xs text-white/80">Call time left</p>
          <p className="text-2xl font-bold tabular-nums">{formatDuration(balanceSeconds)}</p>
          <button onClick={() => setTab('account')} className="press mt-2 w-full rounded-lg bg-white/15 py-1.5 text-sm font-semibold transition hover:bg-white/25">Buy time</button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((it) => (
            <NavButton key={it.key} item={it} active={tab === it.key} onClick={() => setTab(it.key)} />
          ))}
        </nav>

        <div className="mt-auto">
          <p className="mb-2 truncate px-2 text-xs text-muted" title={email}>{email}</p>
          <form action={signOut}>
            <button className="press w-full rounded-xl border border-border py-2 text-sm font-semibold text-red-600 transition hover:bg-red-500/5">Log out</button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <PhoneBadge />
            <span className="font-bold">CallDad</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${hasTime ? 'bg-accent/10 text-accent' : 'bg-amber-500/15 text-amber-600'}`}>
              {hasTime ? formatDuration(balanceSeconds) : 'No time'}
            </span>
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="press grid h-8 w-8 place-items-center rounded-full text-muted">
              <GearIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="hidden items-center px-8 pt-7 md:flex">
          <h1 className="text-3xl font-bold tracking-tight">{titles[tab]}</h1>
        </div>

        {!canCall && (
          <div className="mx-4 mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-700 md:mx-8 dark:text-amber-400">
            Build your contacts and dialer — calling unlocks soon.
          </div>
        )}
        {canCall && hasTime && balanceSeconds < LOW_TIME_SECONDS && (
          <button onClick={() => setTab('account')} className="mx-4 mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-center text-sm font-medium text-amber-700 transition hover:bg-amber-500/20 md:mx-8 dark:text-amber-400">
            ⏳ Running low — {formatDuration(balanceSeconds)} left. Tap to top up.
          </button>
        )}

        <main key={tab} className="flex-1 animate-fade-in overflow-y-auto px-4 pb-24 pt-4 md:px-8 md:pb-8">
          {tab === 'contacts' && (
            <ContactsView
              contacts={contacts}
              canCall={callableNow}
              onCall={placeCall}
              onEdit={(c) => setSheet({ mode: 'edit', contact: c })}
              onDelete={async (id) => { await supabase.from('contacts').delete().eq('id', id); loadContacts(); }}
              onToggleFavorite={toggleFavorite}
              onAdd={() => setSheet({ mode: 'add' })}
              onImport={() => fileInputRef.current?.click()}
            />
          )}
          {tab === 'keypad' && (
            <KeypadView value={keypad} setValue={setKeypad} dtmf={dtmf} canCall={callableNow} disabledReason={callDisabledReason} onCall={() => placeCall(keypad, '')} onSaveContact={() => setSheet({ mode: 'add', prefill: keypad })} />
          )}
          {tab === 'recents' && (
            <RecentsView recents={recents} contacts={contacts} canCall={callableNow} onCall={placeCall} onSave={(num) => setSheet({ mode: 'add', prefill: num })} />
          )}
          {tab === 'account' && (
            <AccountView email={email} balanceSeconds={balanceSeconds} testTopupEnabled={testTopupEnabled} onPurchased={refreshBalance} />
          )}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-border bg-tabbar px-2 py-2 backdrop-blur-xl md:hidden">
          {NAV.map((it) => {
            const active = tab === it.key;
            return (
              <button key={it.key} onClick={() => setTab(it.key)} className={`press flex flex-col items-center gap-0.5 rounded-xl py-1 ${active ? 'text-accent' : 'text-muted'}`}>
                <TabIcon tab={it.key} className="h-6 w-6" />
                <span className="text-[11px] font-medium">{it.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* hidden import file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".vcf,.csv,text/vcard,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importContacts(f);
          e.target.value = '';
        }}
      />

      {importMsg && (
        <div className="fixed inset-x-0 bottom-24 z-40 mx-auto w-fit animate-slide-up rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg md:bottom-6">
          {importMsg}
        </div>
      )}

      {callState !== 'idle' && (
        <CallOverlay
          peer={callPeer}
          state={callState}
          seconds={seconds}
          muted={muted}
          quality={quality}
          reconnecting={reconnecting}
          onToggleMute={toggleMute}
          onSendDigit={sendDigit}
          onPlaySound={playSound}
          onHangUp={hangUp}
        />
      )}

      {sheet && (
        <ContactSheet mode={sheet.mode} initial={sheet.contact} prefill={sheet.prefill} onClose={() => setSheet(null)} onSave={saveContact} />
      )}

      {settingsOpen && <Settings email={email} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/* ----------------------------- Settings ----------------------------- */
function Settings({ email, onClose }: { email: string; onClose: () => void }) {
  const [theme, setTheme] = useTheme();
  const supabase = useMemo(() => createClient(), []);
  const [pwMsg, setPwMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  const sendReset = async () => {
    setPwMsg('Sending…');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
    setPwMsg(error ? error.message : 'Check your email for a reset link.');
  };

  const themes: { id: Theme; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-stretch justify-end bg-black/40" onClick={onClose}>
      <div className="animate-slide-up flex h-full w-full max-w-md flex-col overflow-y-auto bg-background p-6 shadow-2xl md:animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Settings</h2>
          <button onClick={onClose} className="press grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-foreground/5">✕</button>
        </div>

        <Section title="Appearance">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-card p-1">
            {themes.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)} className={`press rounded-lg py-2 text-sm font-semibold transition ${theme === t.id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Account">
          <Row label="Email" value={email} />
          <button onClick={sendReset} className="press mt-2 w-full rounded-xl border border-border bg-card py-2.5 text-sm font-semibold transition hover:bg-foreground/5">Change password</button>
          {pwMsg && <p className="mt-2 text-xs text-muted">{pwMsg}</p>}
        </Section>

        <Section title="About">
          <a href="/about" target="_blank" rel="noreferrer" className="press flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition hover:bg-foreground/5">
            <span>The CallDad story</span><span className="text-muted">↗</span>
          </a>
          <p className="mt-2 px-1 text-xs text-muted">CallDad · cheap calls home · v1</p>
        </Section>

        <Section title="Danger zone">
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="press w-full rounded-xl border border-red-500/30 bg-red-500/5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-500/10">Delete account</button>
          ) : (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm font-medium text-red-600">Permanently delete your account, contacts, and call history?</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="press flex-1 rounded-lg border border-border bg-card py-2 text-sm font-semibold">Cancel</button>
                <button disabled={deleting} onClick={() => startDelete(async () => { const r = await deleteAccount(); if (r.ok) window.location.href = '/'; })} className="press flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {deleting ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </div>
          )}
        </Section>

        <form action={signOut} className="mt-auto pt-4">
          <button className="press w-full rounded-xl border border-border bg-card py-3 font-semibold text-red-600">Log out</button>
        </form>
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="max-w-[12rem] truncate text-sm font-medium">{value}</span>
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: { key: Tab; label: string }; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`press flex items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium transition ${active ? 'bg-accent/10 text-accent' : 'text-foreground/70 hover:bg-foreground/5'}`}>
      <TabIcon tab={item.key} className="h-5 w-5" />
      {item.label}
    </button>
  );
}

/* ----------------------------- Contacts ----------------------------- */
function ContactRow({
  c, canCall, onCall, onEdit, onDelete, onToggleFavorite,
}: {
  c: Contact;
  canCall: boolean;
  onCall: (n: string, name: string) => void;
  onEdit: (c: Contact) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (c: Contact) => void;
}) {
  return (
    <li className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <Avatar name={c.name} />
      <button onClick={() => canCall && onCall(c.phone_number, c.name)} className="min-w-0 flex-1 text-left">
        <p className="truncate font-semibold">{c.name}</p>
        <p className="truncate text-sm text-muted">{prettyNumber(c.phone_number)}</p>
      </button>
      <div className="flex items-center gap-1">
        <button onClick={() => onToggleFavorite(c)} aria-label="Favorite" className={`press grid h-9 w-9 place-items-center rounded-full transition ${c.is_favorite ? 'text-amber-400' : 'text-muted opacity-70 hover:opacity-100'}`}>
          <StarIcon filled={!!c.is_favorite} className="h-5 w-5" />
        </button>
        <button onClick={() => onCall(c.phone_number, c.name)} aria-label={`Call ${c.name}`} className="press grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent transition hover:bg-accent/20">
          <PhoneIcon className="h-5 w-5" />
        </button>
        <button onClick={() => onEdit(c)} aria-label={`Edit ${c.name}`} className="press grid h-9 w-9 place-items-center rounded-full text-muted opacity-60 transition hover:bg-foreground/5 hover:text-foreground md:opacity-0 md:group-hover:opacity-100">
          <PencilIcon className="h-4 w-4" />
        </button>
        <button onClick={() => onDelete(c.id)} aria-label={`Delete ${c.name}`} className="press grid h-9 w-9 place-items-center rounded-full text-muted opacity-60 transition hover:bg-red-500/10 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100">✕</button>
      </div>
    </li>
  );
}

function ContactsView({
  contacts, canCall, onCall, onEdit, onDelete, onToggleFavorite, onAdd, onImport,
}: {
  contacts: Contact[];
  canCall: boolean;
  onCall: (n: string, name: string) => void;
  onEdit: (c: Contact) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (c: Contact) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const [q, setQ] = useState('');
  const rowProps = { canCall, onCall, onEdit, onDelete, onToggleFavorite };

  if (contacts.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-5xl">👋</div>
        <p className="text-lg font-semibold">No contacts yet</p>
        <p className="max-w-xs text-sm text-muted">Add the people you call most, or import them from your phone.</p>
        <div className="mt-2 flex gap-2">
          <button onClick={onAdd} className="press rounded-full bg-accent px-5 py-2 font-semibold text-white">+ Add contact</button>
          <button onClick={onImport} className="press rounded-full border border-border px-5 py-2 font-semibold transition hover:bg-foreground/5">Import</button>
        </div>
        <p className="mt-1 text-xs text-muted">Import a .vcf (phone export) or .csv file.</p>
      </div>
    );
  }

  const filtered = contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone_number.includes(q.replace(/\D/g, '')));
  const favs = filtered.filter((c) => c.is_favorite);
  const rest = filtered.filter((c) => !c.is_favorite);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-2.5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30" />
        <button onClick={onAdd} className="press rounded-xl bg-accent px-4 py-2.5 font-semibold text-white transition hover:brightness-110">+ Add</button>
        <button onClick={onImport} className="press rounded-xl border border-border px-4 py-2.5 font-semibold transition hover:bg-foreground/5">Import</button>
      </div>
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No matches.</p>
      ) : (
        <>
          {favs.length > 0 && (
            <>
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                <StarIcon filled className="h-3.5 w-3.5 text-amber-400" /> Favorites
              </p>
              <ul className="mb-5 grid gap-3 sm:grid-cols-2">
                {favs.map((c) => <ContactRow key={c.id} c={c} {...rowProps} />)}
              </ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              {favs.length > 0 && <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">All contacts</p>}
              <ul className="grid gap-3 sm:grid-cols-2">
                {rest.map((c) => <ContactRow key={c.id} c={c} {...rowProps} />)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------- Keypad ----------------------------- */
function KeypadView({
  value, setValue, dtmf, canCall, disabledReason, onCall, onSaveContact,
}: {
  value: string;
  setValue: (v: string) => void;
  dtmf: (k: string) => void;
  canCall: boolean;
  disabledReason: string;
  onCall: () => void;
  onSaveContact: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const sub: Record<string, string> = {
    '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ',
  };
  const press = (k: string) => { setValue(value + k); dtmf(k); };

  return (
    <div className="mx-auto flex w-full max-w-[16.5rem] flex-col items-center pt-3">
      <div className="flex min-h-[3.25rem] items-center justify-center">
        <span className="truncate text-center text-[2rem] font-light tracking-wide">
          {formatDial(value) || <span className="text-muted/40">Enter a number</span>}
        </span>
      </div>

      <div className="grid w-full grid-cols-3 gap-2.5 py-4">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            onContextMenu={(e) => { if (k === '0') { e.preventDefault(); setValue(value + '+'); } }}
            className="press relative mx-auto grid h-[4.4rem] w-[4.4rem] place-items-center rounded-full border border-border/70 bg-card shadow-sm transition hover:border-accent/50 hover:bg-accent/5 active:bg-accent/15"
          >
            <span className="text-[1.7rem] font-normal leading-none">{k}</span>
            {sub[k] && <span className="absolute bottom-[0.65rem] text-[0.5rem] font-semibold tracking-[0.16em] text-muted">{sub[k]}</span>}
            {k === '0' && <span className="absolute bottom-[0.65rem] text-[0.6rem] font-semibold text-muted">+</span>}
          </button>
        ))}
      </div>

      <div className="flex w-full items-center justify-between px-1 pt-1">
        <div className="w-12 text-center">{value && <button onClick={onSaveContact} className="press text-sm font-semibold text-accent">Save</button>}</div>
        <button onClick={onCall} disabled={!canCall || !value} title={disabledReason} className="press grid h-[4.4rem] w-[4.4rem] place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none">
          <PhoneIcon className="h-7 w-7" />
        </button>
        <div className="w-12 text-center">{value && <button onClick={() => setValue(value.slice(0, -1))} aria-label="Backspace" className="press text-2xl text-muted">⌫</button>}</div>
      </div>
      <p className="pt-3 text-center text-xs text-muted/70">Tip: type on your keyboard, Enter to call</p>
      {disabledReason && <p className="pt-1 text-center text-sm text-muted">{disabledReason}</p>}
    </div>
  );
}

/* ----------------------------- Recents ----------------------------- */
function RecentsView({
  recents, contacts, canCall, onCall, onSave,
}: {
  recents: CallRow[];
  contacts: Contact[];
  canCall: boolean;
  onCall: (n: string, name: string) => void;
  onSave: (num: string) => void;
}) {
  if (recents.length === 0) return <EmptyState emoji="🕘" title="No recent calls" body="Calls you make will show up here." />;
  const nameFor = (num: string) => contacts.find((c) => c.phone_number === num)?.name ?? '';
  return (
    <ul className="mx-auto flex w-full max-w-2xl flex-col gap-2">
      {recents.map((r, i) => {
        const name = nameFor(r.to_number);
        const known = !!name;
        return (
          <li key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            {known ? <Avatar name={name} /> : <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted/15 text-lg">📞</div>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{name || prettyNumber(r.to_number)}</p>
              <p className="text-sm text-muted">{mmss(r.seconds)} · {new Date(r.created_at).toLocaleDateString()}</p>
            </div>
            {!known && <button onClick={() => onSave(r.to_number)} className="press rounded-full px-3 py-1 text-sm font-semibold text-accent hover:bg-accent/10">Save</button>}
            {canCall && (
              <button onClick={() => onCall(r.to_number, name)} aria-label="Call back" className="press grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent transition hover:bg-accent/20">
                <PhoneIcon className="h-5 w-5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------- Account / Buy time ----------------------------- */
function AccountView({
  email, balanceSeconds, testTopupEnabled, onPurchased,
}: {
  email: string;
  balanceSeconds: number;
  testTopupEnabled: boolean;
  onPurchased: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [customMin, setCustomMin] = useState(CUSTOM_MIN_MINUTES);

  const purchase = (id: string, input: BuyInput) => {
    setError('');
    setBusyId(id);
    startTransition(async () => {
      const res = await buyTime(input);
      setBusyId('');
      if (!res.ok) setError(res.error ?? 'Purchase failed.');
      else onPurchased();
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="rounded-3xl bg-gradient-to-br from-accent to-emerald-700 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/80">Call time left</p>
          {testTopupEnabled && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">Test mode</span>}
        </div>
        <p className="mt-1 text-5xl font-bold tabular-nums">{formatDuration(balanceSeconds)}</p>
        <p className="mt-2 text-xs text-white/70">Time is billed by the minute while you talk.</p>
      </div>

      {testTopupEnabled && (
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-bold">Buy call time</h2>
          <p className="mb-4 text-sm text-muted">The more you buy, the cheaper per minute.</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {PACKAGES.map((p) => (
              <button key={p.id} disabled={pending} onClick={() => purchase(p.id, { packageId: p.id })} className="press flex flex-col items-start gap-1 rounded-2xl border border-border p-4 text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md disabled:opacity-60">
                <span className="text-2xl font-bold">{formatPrice(p.priceCents)}</span>
                <span className="font-semibold">{p.label}</span>
                <span className="text-xs text-muted">{p.blurb} · {ratePerMinCents(p.priceCents, p.minutes)}¢/min</span>
                <span className="mt-1 text-xs font-semibold text-accent">{busyId === p.id ? 'Adding…' : 'Buy'}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-background p-4">
            <p className="text-sm font-semibold">More than 2 hours</p>
            <p className="mb-3 text-xs text-muted">Flat 10¢/min above the 2-hour pack.</p>
            <div className="flex items-center gap-2">
              <input type="number" min={CUSTOM_MIN_MINUTES} max={CUSTOM_MAX_MINUTES} value={customMin} onChange={(e) => setCustomMin(Math.max(0, parseInt(e.target.value || '0', 10)))} className="w-24 rounded-lg border border-border bg-card px-3 py-2 outline-none focus:border-accent" />
              <span className="text-sm text-muted">min</span>
              <button disabled={pending || customMin < CUSTOM_MIN_MINUTES} onClick={() => purchase('custom', { customMinutes: customMin })} className="press ml-auto rounded-full bg-accent px-4 py-1.5 font-bold text-white disabled:opacity-50">
                {busyId === 'custom' ? '…' : formatPrice(customPriceCents(customMin))}
              </button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <p className="mt-3 text-center text-xs text-muted">Stripe card payments coming soon.</p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs text-muted">Signed in as</p>
        <p className="truncate font-medium">{email}</p>
      </div>
    </div>
  );
}

/* ----------------------------- Call overlay ----------------------------- */
function QualityBars({ quality }: { quality: Quality }) {
  const filled = quality === 'good' ? 4 : 2;
  const color = quality === 'good' ? 'bg-emerald-400' : 'bg-amber-400';
  return (
    <div className="flex items-end gap-0.5" aria-label={`Connection ${quality}`}>
      {[3, 6, 9, 12].map((h, i) => (
        <span key={i} className={`w-1 rounded-sm ${i < filled ? color : 'bg-white/20'}`} style={{ height: h }} />
      ))}
    </div>
  );
}

function CallOverlay({
  peer, state, seconds, muted, quality, reconnecting, onToggleMute, onSendDigit, onPlaySound, onHangUp,
}: {
  peer: { name: string; number: string };
  state: CallState;
  seconds: number;
  muted: boolean;
  quality: Quality;
  reconnecting: boolean;
  onToggleMute: () => void;
  onSendDigit: (d: string) => void;
  onPlaySound: (id: SfxId) => void;
  onHangUp: () => void;
}) {
  const [panel, setPanel] = useState<'none' | 'keys' | 'sounds'>('none');
  const live = state === 'live';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const label = reconnecting ? 'Reconnecting…' : state === 'connecting' ? 'Calling…' : live ? mmss(seconds) : 'Call ended';

  return (
    <div className="fixed inset-0 z-[55] flex animate-fade-in flex-col items-center justify-between bg-gradient-to-b from-neutral-900/95 to-black/95 px-6 py-14 text-white backdrop-blur">
      <div className="mt-6 flex flex-col items-center gap-4">
        <div className={`grid h-32 w-32 place-items-center rounded-full ${peer.name ? colorFor(peer.name) : 'bg-white/10'} text-5xl font-semibold ${live && !reconnecting ? 'pulse-ring' : ''}`}>
          {peer.name ? initials(peer.name) : '📞'}
        </div>
        <p className="text-3xl font-semibold">{peer.name || prettyNumber(peer.number)}</p>
        <div className="flex items-center gap-2">
          {live && !reconnecting && <QualityBars quality={quality} />}
          <p className={reconnecting ? 'text-amber-400' : 'text-white/70'}>{label}</p>
        </div>
        {live && quality === 'poor' && !reconnecting && <p className="text-xs text-amber-400/80">Weak connection</p>}
      </div>

      {panel === 'keys' ? (
        <div className="grid w-full max-w-[15rem] grid-cols-3 gap-3">
          {keys.map((k) => (
            <button key={k} onClick={() => onSendDigit(k)} className="press grid h-14 w-14 place-items-center justify-self-center rounded-full bg-white/10 text-2xl font-light hover:bg-white/20">{k}</button>
          ))}
          <button onClick={() => setPanel('none')} className="press col-span-3 mt-1 text-sm font-semibold text-white/70">Hide keypad</button>
        </div>
      ) : panel === 'sounds' ? (
        <div className="w-full max-w-[20rem]">
          <p className="mb-2 px-1 text-center text-xs text-white/50">Everyone on the call hears these</p>
          <div className="grid grid-cols-3 gap-2.5">
            {SOUNDS.map((s) => (
              <button key={s.id} onClick={() => onPlaySound(s.id)} className="press flex flex-col items-center gap-1 rounded-2xl bg-white/10 py-3 transition hover:bg-white/20 active:scale-95 active:bg-white/30">
                <span className="text-2xl leading-none">{s.emoji}</span>
                <span className="text-[11px] font-medium text-white/80">{s.label}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setPanel('none')} className="press mt-3 w-full py-2 text-sm font-semibold text-white/70">Hide sounds</button>
        </div>
      ) : (
        <div className="grid w-full max-w-[15rem] grid-cols-3 gap-x-6 gap-y-5">
          <CallCtl active={muted} disabled={!live} onClick={onToggleMute} label={muted ? 'Unmute' : 'Mute'} icon={<MuteIcon className="h-6 w-6" />} />
          <CallCtl disabled={!live} onClick={() => setPanel('keys')} label="Keypad" icon={<KeypadIcon className="h-6 w-6" />} />
          <CallCtl disabled={!live} onClick={() => setPanel('sounds')} label="Sounds" icon={<SoundsIcon className="h-6 w-6" />} />
        </div>
      )}

      <button onClick={onHangUp} aria-label="Hang up" className="press grid h-16 w-16 place-items-center rounded-full bg-red-600 shadow-lg transition hover:brightness-110">
        <PhoneIcon className="h-7 w-7 rotate-[135deg]" />
      </button>
    </div>
  );
}
function CallCtl({ active, disabled, onClick, label, icon }: { active?: boolean; disabled?: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button onClick={onClick} disabled={disabled} className={`press grid h-16 w-16 place-items-center rounded-full transition disabled:opacity-30 ${active ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>
        {icon}
      </button>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

/* ----------------------------- Add/Edit contact ----------------------------- */
function ContactSheet({
  mode, initial, prefill, onClose, onSave,
}: {
  mode: 'add' | 'edit';
  initial?: Contact;
  prefill?: string;
  onClose: () => void;
  onSave: (name: string, number: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [number, setNumber] = useState(initial?.phone_number ?? prefill ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = name.trim();
    const num = normalizeNumber(number);
    if (!n) return setError('Enter a name.');
    if (!isValidE164(num)) return setError('Enter a valid number, e.g. +1 415 555 1234.');
    setSaving(true);
    const err = await onSave(n, num);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div className="animate-slide-up w-full rounded-t-3xl bg-card p-6 shadow-2xl md:max-w-md md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{mode === 'edit' ? 'Edit contact' : 'New contact'}</h2>
          <button onClick={onClose} className="text-sm font-semibold text-muted">Cancel</button>
        </div>
        <div className="flex flex-col gap-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Phone number" inputMode="tel" className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button onClick={save} disabled={saving} className="press mt-1 rounded-xl bg-accent py-2.5 font-semibold text-white disabled:opacity-60">
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- bits ----------------------------- */
function Avatar({ name }: { name: string }) {
  return <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${colorFor(name)} text-sm font-bold text-white`}>{initials(name)}</div>;
}
function EmptyState({ emoji, title, body, action }: { emoji: string; title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-5xl">{emoji}</div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
      {action && <button onClick={action.onClick} className="press mt-2 rounded-full bg-accent px-5 py-2 font-semibold text-white">{action.label}</button>}
    </div>
  );
}
function PhoneBadge() {
  return <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-white shadow-sm"><PhoneIcon className="h-4 w-4" /></span>;
}

/* ----------------------------- icons ----------------------------- */
function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  if (tab === 'contacts') return <ContactsIcon className={className} />;
  if (tab === 'keypad') return <KeypadIcon className={className} />;
  if (tab === 'recents') return <ClockIcon className={className} />;
  return <PersonIcon className={className} />;
}
function PhoneIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" /></svg>;
}
function PencilIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M4 20h4L18 10l-4-4L4 16v4z" strokeLinejoin="round" /><path d="M13.5 6.5l4 4" strokeLinecap="round" /></svg>;
}
function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className={className}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.8 1-5.8L3.5 9.2l5.9-.9L12 3z" strokeLinejoin="round" /></svg>;
}
function GearIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7.7 1.6 1.6 0 0 0-1 1.5V22a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-1.1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.5-1.1 1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 6.1 3l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 21 6.1l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" /></svg>;
}
function MuteIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="M9 9v3a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-6 0v1M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-.5 2.6M12 19v3M3 3l18 18" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SoundsIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><path d="M3 14v-4M7 17V7M12 20V4M17 17V7M21 14v-4" /></svg>;
}
function ContactsIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z" /></svg>;
}
function KeypadIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className}>{[5, 12, 19].map((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}</svg>;
}
function ClockIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PersonIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" /></svg>;
}
