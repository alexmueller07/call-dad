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
import {
  PACKAGES,
  CUSTOM_MIN_MINUTES,
  CUSTOM_MAX_MINUTES,
  customPriceCents,
  formatPrice,
  formatDuration,
  ratePerMinCents,
} from '@/lib/pricing';
import { buyTime, type BuyInput } from './actions/billing';
import { signOut } from './login/actions';

type Tab = 'contacts' | 'keypad' | 'recents' | 'account';
type Contact = { id: string; name: string; phone_number: string };
type CallRow = { to_number: string; seconds: number; created_at: string };
type CallState = 'idle' | 'connecting' | 'live' | 'ended';

type Props = {
  userId: string;
  email: string;
  initialBalanceSeconds: number;
  canCall: boolean;
  testTopupEnabled: boolean;
};

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '#';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function prettyNumber(n: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : n;
}

export function PhoneApp({ userId, email, initialBalanceSeconds, canCall, testTopupEnabled }: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>('keypad');
  const [balanceSeconds, setBalanceSeconds] = useState(initialBalanceSeconds);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recents, setRecents] = useState<CallRow[]>([]);
  const [keypad, setKeypad] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const hasTime = balanceSeconds > 0;

  // ---- Twilio device ----
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callPeer, setCallPeer] = useState<{ name: string; number: string }>({ name: '', number: '' });
  const [seconds, setSeconds] = useState(0);

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
        await device.register();
        if (cancelled) return;
        deviceRef.current = device;
        setDeviceReady(true);
      } catch {
        /* leave deviceReady false */
      }
    })();
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [canCall]);

  // ---- data ----
  const loadContacts = useCallback(async () => {
    const { data } = await supabase
      .from('contacts')
      .select('id,name,phone_number')
      .order('name', { ascending: true });
    setContacts(data ?? []);
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
    const { data } = await supabase
      .from('profiles')
      .select('balance_seconds')
      .eq('id', userId)
      .single();
    if (data) setBalanceSeconds(data.balance_seconds);
  }, [supabase, userId]);

  useEffect(() => {
    loadContacts();
    loadRecents();
  }, [loadContacts, loadRecents]);

  // ---- calling ----
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

      setCallPeer({ name: name || prettyNumber(number), number });
      setCallState('connecting');
      const call = await deviceRef.current.connect({ params: { To: number } });
      callRef.current = call;

      call.on('accept', () => {
        setCallState('live');
        startTimer();
      });
      const onEnd = () => {
        stopTimer();
        callRef.current = null;
        setCallState('ended');
        loadRecents();
        refreshBalance();
        setTimeout(() => setCallState('idle'), 1100);
      };
      call.on('disconnect', onEnd);
      call.on('cancel', onEnd);
      call.on('reject', onEnd);
    },
    [canCall, hasTime, loadRecents, refreshBalance],
  );

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
  }, []);

  const callableNow = canCall && deviceReady && hasTime;
  const callDisabledReason = !canCall
    ? "Calling isn't enabled for your account yet."
    : !hasTime
      ? 'Buy call time to start calling.'
      : !deviceReady
        ? 'Connecting…'
        : '';

  return (
    <div className="flex min-h-screen items-center justify-center sm:p-4">
      <div className="relative flex h-[100dvh] w-full max-w-[400px] flex-col overflow-hidden bg-screen shadow-2xl shadow-black/30 sm:h-[min(860px,94vh)] sm:rounded-[2.75rem] sm:border sm:border-border">
        <Header tab={tab} onAdd={() => setShowAdd(true)} balanceSeconds={balanceSeconds} />

        {!canCall && (
          <div className="mx-4 mb-1 rounded-xl bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-700 dark:text-amber-400">
            Build your contacts and dialer — calling unlocks soon.
          </div>
        )}

        <main key={tab} className="no-scrollbar flex-1 animate-fade-in overflow-y-auto px-4 pb-4">
          {tab === 'contacts' && (
            <ContactsView
              contacts={contacts}
              canCall={callableNow}
              onCall={placeCall}
              onDelete={async (id) => {
                await supabase.from('contacts').delete().eq('id', id);
                loadContacts();
              }}
              onAdd={() => setShowAdd(true)}
            />
          )}
          {tab === 'keypad' && (
            <KeypadView
              value={keypad}
              setValue={setKeypad}
              canCall={callableNow}
              disabledReason={callDisabledReason}
              onCall={() => placeCall(keypad, '')}
              onSaveContact={() => setShowAdd(true)}
            />
          )}
          {tab === 'recents' && (
            <RecentsView recents={recents} contacts={contacts} canCall={callableNow} onCall={placeCall} />
          )}
          {tab === 'account' && (
            <AccountView
              email={email}
              balanceSeconds={balanceSeconds}
              testTopupEnabled={testTopupEnabled}
              onPurchased={refreshBalance}
            />
          )}
        </main>

        <TabBar tab={tab} setTab={setTab} />

        {callState !== 'idle' && (
          <CallOverlay peer={callPeer} state={callState} seconds={seconds} onHangUp={hangUp} />
        )}

        {showAdd && (
          <AddContactSheet
            prefill={tab === 'keypad' ? keypad : ''}
            onClose={() => setShowAdd(false)}
            onSave={async (name, number) => {
              const { error } = await supabase
                .from('contacts')
                .insert({ user_id: userId, name, phone_number: number });
              if (error) return error.message;
              setShowAdd(false);
              loadContacts();
              setTab('contacts');
              return null;
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Header ----------------------------- */
function Header({ tab, onAdd, balanceSeconds }: { tab: Tab; onAdd: () => void; balanceSeconds: number }) {
  const titles: Record<Tab, string> = {
    contacts: 'Contacts',
    keypad: 'Keypad',
    recents: 'Recents',
    account: 'Account',
  };
  const out = balanceSeconds <= 0;
  return (
    <header className="flex items-end justify-between px-4 pb-2 pt-5">
      <h1 className="text-3xl font-bold tracking-tight">{titles[tab]}</h1>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-1 text-sm font-semibold ${
            out ? 'bg-amber-500/15 text-amber-600' : 'bg-accent/10 text-accent'
          }`}
        >
          {out ? 'No time' : formatDuration(balanceSeconds)}
        </span>
        {tab === 'contacts' && (
          <button
            onClick={onAdd}
            aria-label="Add contact"
            className="press grid h-9 w-9 place-items-center rounded-full bg-accent text-2xl leading-none text-white shadow"
          >
            +
          </button>
        )}
      </div>
    </header>
  );
}

/* ----------------------------- Contacts ----------------------------- */
function ContactsView({
  contacts,
  canCall,
  onCall,
  onDelete,
  onAdd,
}: {
  contacts: Contact[];
  canCall: boolean;
  onCall: (n: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  if (contacts.length === 0) {
    return (
      <EmptyState
        emoji="👋"
        title="No contacts yet"
        body="Add the people you call most for one-tap dialing."
        action={{ label: '+ Add contact', onClick: onAdd }}
      />
    );
  }
  return (
    <ul className="mt-1 flex flex-col gap-1.5">
      {contacts.map((c) => (
        <li
          key={c.id}
          className="group flex items-center gap-3 rounded-2xl bg-card p-3 shadow-sm transition hover:shadow"
        >
          <Avatar text={initials(c.name)} />
          <button
            onClick={() => canCall && onCall(c.phone_number, c.name)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate font-semibold">{c.name}</p>
            <p className="truncate text-sm text-muted">{prettyNumber(c.phone_number)}</p>
          </button>
          <button
            onClick={() => onCall(c.phone_number, c.name)}
            aria-label={`Call ${c.name}`}
            className="press grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent"
          >
            <PhoneIcon className="h-5 w-5" />
          </button>
          <button
            onClick={() => onDelete(c.id)}
            aria-label={`Delete ${c.name}`}
            className="press grid h-9 w-9 place-items-center rounded-full text-muted opacity-0 transition group-hover:opacity-100"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------- Keypad ----------------------------- */
function KeypadView({
  value,
  setValue,
  canCall,
  disabledReason,
  onCall,
  onSaveContact,
}: {
  value: string;
  setValue: (v: string) => void;
  canCall: boolean;
  disabledReason: string;
  onCall: () => void;
  onSaveContact: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const sub: Record<string, string> = {
    '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL',
    '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+',
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-[4.5rem] items-center justify-center pt-2">
        <span className="truncate text-center text-4xl font-light tracking-wide">
          {value || <span className="text-muted/50">Enter a number</span>}
        </span>
      </div>

      <div className="mx-auto grid w-full max-w-[20rem] grid-cols-3 gap-3 py-3">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => setValue(value + k)}
            onContextMenu={(e) => {
              if (k === '0') {
                e.preventDefault();
                setValue(value + '+');
              }
            }}
            className="press mx-auto grid h-[4.2rem] w-[4.2rem] place-items-center rounded-full bg-card shadow-sm active:bg-accent/10"
          >
            <span className="text-3xl font-light leading-none">{k}</span>
            {sub[k] && <span className="mt-0.5 text-[10px] font-semibold tracking-widest text-muted">{sub[k]}</span>}
          </button>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-center gap-6 pb-2">
        <div className="w-12 text-center">
          {value && (
            <button onClick={onSaveContact} className="press text-xs font-semibold text-accent">
              Save
            </button>
          )}
        </div>
        <button
          onClick={onCall}
          disabled={!canCall || !value}
          title={disabledReason}
          className="press grid h-[4.6rem] w-[4.6rem] place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 disabled:opacity-40"
        >
          <PhoneIcon className="h-7 w-7" />
        </button>
        <div className="w-12 text-center">
          {value && (
            <button onClick={() => setValue(value.slice(0, -1))} aria-label="Backspace" className="press text-2xl text-muted">
              ⌫
            </button>
          )}
        </div>
      </div>
      {disabledReason && (
        <p className="pb-2 text-center text-xs text-muted">{disabledReason}</p>
      )}
    </div>
  );
}

/* ----------------------------- Recents ----------------------------- */
function RecentsView({
  recents,
  contacts,
  canCall,
  onCall,
}: {
  recents: CallRow[];
  contacts: Contact[];
  canCall: boolean;
  onCall: (n: string, name: string) => void;
}) {
  if (recents.length === 0) {
    return <EmptyState emoji="🕘" title="No recent calls" body="Calls you make will show up here." />;
  }
  const nameFor = (num: string) => contacts.find((c) => c.phone_number === num)?.name ?? '';
  return (
    <ul className="mt-1 flex flex-col gap-1.5">
      {recents.map((r, i) => {
        const name = nameFor(r.to_number);
        return (
          <li key={i} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-sm">
            <Avatar text={name ? initials(name) : '📞'} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{name || prettyNumber(r.to_number)}</p>
              <p className="text-sm text-muted">
                {mmss(r.seconds)} · {new Date(r.created_at).toLocaleDateString()}
              </p>
            </div>
            {canCall && (
              <button
                onClick={() => onCall(r.to_number, name)}
                aria-label="Call back"
                className="press grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent"
              >
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
  email,
  balanceSeconds,
  testTopupEnabled,
  onPurchased,
}: {
  email: string;
  balanceSeconds: number;
  testTopupEnabled: boolean;
  onPurchased: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string>('');
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
    <div className="mt-2 flex flex-col gap-4">
      {/* Balance */}
      <div className="rounded-3xl bg-gradient-to-br from-accent to-emerald-700 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/80">Call time left</p>
          {testTopupEnabled && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              Test mode
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-bold tabular-nums">{formatDuration(balanceSeconds)}</p>
        <p className="mt-2 text-xs text-white/70">Time is used per second while you talk.</p>
      </div>

      {/* Buy time */}
      {testTopupEnabled && (
        <div className="rounded-3xl bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-bold">Buy call time</h2>
          <p className="mb-4 text-sm text-muted">The more you buy, the cheaper per minute.</p>

          <div className="flex flex-col gap-2.5">
            {PACKAGES.map((p) => (
              <button
                key={p.id}
                disabled={pending}
                onClick={() => purchase(p.id, { packageId: p.id })}
                className="press flex items-center justify-between rounded-2xl border border-border p-4 text-left transition hover:border-accent disabled:opacity-60"
              >
                <span>
                  <span className="block font-semibold">{p.label}</span>
                  <span className="block text-xs text-muted">
                    {p.blurb} · {ratePerMinCents(p.priceCents, p.minutes)}¢/min
                  </span>
                </span>
                <span className="rounded-full bg-accent px-4 py-1.5 font-bold text-white">
                  {busyId === p.id ? '…' : formatPrice(p.priceCents)}
                </span>
              </button>
            ))}
          </div>

          {/* Custom */}
          <div className="mt-4 rounded-2xl bg-background p-4">
            <p className="text-sm font-semibold">More than 2 hours</p>
            <p className="mb-3 text-xs text-muted">Flat 10¢/min above the 2-hour pack.</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={CUSTOM_MIN_MINUTES}
                max={CUSTOM_MAX_MINUTES}
                value={customMin}
                onChange={(e) => setCustomMin(Math.max(0, parseInt(e.target.value || '0', 10)))}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 outline-none focus:border-accent"
              />
              <span className="text-sm text-muted">min</span>
              <button
                disabled={pending || customMin < CUSTOM_MIN_MINUTES}
                onClick={() => purchase('custom', { customMinutes: customMin })}
                className="press ml-auto rounded-full bg-accent px-4 py-1.5 font-bold text-white disabled:opacity-50"
              >
                {busyId === 'custom' ? '…' : formatPrice(customPriceCents(customMin))}
              </button>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <p className="mt-3 text-center text-xs text-muted">Stripe card payments coming soon.</p>
        </div>
      )}

      <div className="rounded-2xl bg-card p-4 shadow-sm">
        <p className="text-xs text-muted">Signed in as</p>
        <p className="truncate font-medium">{email}</p>
      </div>

      <form action={signOut}>
        <button className="press w-full rounded-2xl bg-card py-3 font-semibold text-red-600 shadow-sm">
          Log out
        </button>
      </form>
    </div>
  );
}

/* ----------------------------- Call overlay ----------------------------- */
function CallOverlay({
  peer,
  state,
  seconds,
  onHangUp,
}: {
  peer: { name: string; number: string };
  state: CallState;
  seconds: number;
  onHangUp: () => void;
}) {
  const label = state === 'connecting' ? 'Calling…' : state === 'live' ? mmss(seconds) : 'Call ended';
  return (
    <div className="absolute inset-0 z-20 flex animate-slide-up flex-col items-center justify-between bg-gradient-to-b from-neutral-900 to-black px-6 py-16 text-white sm:rounded-[2.75rem]">
      <div className="mt-10 flex flex-col items-center gap-4">
        <div
          className={`grid h-28 w-28 place-items-center rounded-full bg-white/10 text-4xl font-semibold ${
            state === 'live' ? 'pulse-ring' : ''
          }`}
        >
          {peer.name ? initials(peer.name) : '📞'}
        </div>
        <p className="text-2xl font-semibold">{peer.name || prettyNumber(peer.number)}</p>
        <p className="text-white/70">{label}</p>
      </div>
      <button
        onClick={onHangUp}
        aria-label="Hang up"
        className="press grid h-16 w-16 place-items-center rounded-full bg-red-600 shadow-lg"
      >
        <PhoneIcon className="h-7 w-7 rotate-[135deg]" />
      </button>
    </div>
  );
}

/* ----------------------------- Add contact ----------------------------- */
function AddContactSheet({
  prefill,
  onClose,
  onSave,
}: {
  prefill: string;
  onClose: () => void;
  onSave: (name: string, number: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState(prefill);
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
    <div className="absolute inset-0 z-30 flex animate-fade-in flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="animate-slide-up rounded-t-3xl bg-card p-6 sm:m-3 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">New contact</h2>
          <button onClick={onClose} className="text-sm font-semibold text-muted">
            Cancel
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Phone number"
            inputMode="tel"
            className="rounded-xl border border-border bg-background px-4 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={save}
            disabled={saving}
            className="press mt-1 rounded-xl bg-accent py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Tab bar ----------------------------- */
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { key: Tab; label: string; icon: (c: string) => React.ReactNode }[] = [
    { key: 'contacts', label: 'Contacts', icon: (c) => <ContactsIcon className={c} /> },
    { key: 'keypad', label: 'Keypad', icon: (c) => <KeypadIcon className={c} /> },
    { key: 'recents', label: 'Recents', icon: (c) => <ClockIcon className={c} /> },
    { key: 'account', label: 'Account', icon: (c) => <PersonIcon className={c} /> },
  ];
  return (
    <nav className="grid grid-cols-4 border-t border-border bg-tabbar px-2 py-2 backdrop-blur-xl">
      {items.map((it) => {
        const active = tab === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setTab(it.key)}
            className={`press flex flex-col items-center gap-0.5 rounded-xl py-1 ${
              active ? 'text-accent' : 'text-muted'
            }`}
          >
            {it.icon('h-6 w-6')}
            <span className="text-[11px] font-medium">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ----------------------------- bits ----------------------------- */
function Avatar({ text }: { text: string }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">
      {text}
    </div>
  );
}

function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-5xl">{emoji}</div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="press mt-2 rounded-full bg-accent px-5 py-2 font-semibold text-white"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/* ----------------------------- icons ----------------------------- */
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" />
    </svg>
  );
}
function ContactsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14z" />
    </svg>
  );
}
function KeypadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      {[5, 12, 19].map((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" strokeLinecap="round" />
    </svg>
  );
}
