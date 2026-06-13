'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// Type-only import is erased at build time, so it can't break server rendering.
// The actual SDK is loaded with a dynamic import() inside the effect (browser only).
import type { Call, Device } from '@twilio/voice-sdk';

type Status = 'loading' | 'ready' | 'calling' | 'connected' | 'ended' | 'error';

const CONTACTS = [
  { key: 'dad', label: 'Dad', emoji: '👨' },
  { key: 'grandpa', label: 'Grandpa', emoji: '👴' },
];

export default function Home() {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Setting up…');
  const [seconds, setSeconds] = useState(0);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // Register the Twilio Device once on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/token');
        if (!res.ok) throw new Error(`token request failed (${res.status})`);
        const { token } = await res.json();

        const { Device } = await import('@twilio/voice-sdk');
        if (cancelled) return;

        const device = new Device(token, { logLevel: 1 });
        device.on('error', (err: Error) => {
          setStatus('error');
          setMessage(`Error: ${err.message}`);
        });
        await device.register();
        if (cancelled) return;

        deviceRef.current = device;
        setStatus('ready');
        setMessage('Ready — pick who to call.');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setMessage(`Setup failed: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      stopTimer();
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [stopTimer]);

  const placeCall = useCallback(
    async (contact: string, label: string) => {
      const device = deviceRef.current;
      if (!device) return;

      setStatus('calling');
      setMessage(`Calling ${label}…`);

      // Send only the contact KEY; the server maps it to a real number.
      const call = await device.connect({ params: { contact } });
      callRef.current = call;

      call.on('accept', () => {
        setStatus('connected');
        setMessage(`Connected to ${label}`);
        setSeconds(0);
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      });

      const onEnd = () => {
        stopTimer();
        callRef.current = null;
        setStatus('ended');
        setMessage('Call ended.');
      };
      call.on('disconnect', onEnd);
      call.on('cancel', onEnd);
      call.on('reject', onEnd);
    },
    [stopTimer],
  );

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    deviceRef.current?.disconnectAll();
  }, []);

  const onCall = status === 'calling' || status === 'connected';
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">📞 Call Home</h1>
        <p className="mt-1 text-sm text-gray-500">
          Talk to family on any phone, straight from your browser.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {CONTACTS.map((c) => (
          <button
            key={c.key}
            onClick={() => placeCall(c.key, c.label)}
            disabled={status !== 'ready' && status !== 'ended'}
            className="flex min-w-32 flex-col items-center gap-1 rounded-2xl bg-green-600 px-8 py-5 text-lg font-medium text-white shadow-md transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-3xl">{c.emoji}</span>
            Call {c.label}
          </button>
        ))}
      </div>

      {status === 'connected' && (
        <div className="font-mono text-4xl tabular-nums">{mmss}</div>
      )}

      {onCall && (
        <button
          onClick={hangUp}
          className="rounded-full bg-red-600 px-8 py-3 text-white shadow-md transition hover:bg-red-700"
        >
          Hang up
        </button>
      )}

      <p
        className={`min-h-6 text-sm ${status === 'error' ? 'text-red-600' : 'text-gray-500'}`}
      >
        {message}
      </p>
    </main>
  );
}
