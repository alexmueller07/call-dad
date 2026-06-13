// POST /api/voice — Twilio's servers call this back when the browser places a
// call. The browser passed a `contact` key; we look up the allowed number and
// reply with TwiML telling Twilio to dial it, using our Twilio number as the
// caller ID so a flip phone shows a recognizable US number.
import twilio from 'twilio';
import { CONTACTS, twilioConfig } from '@/lib/twilio-config';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Twilio posts application/x-www-form-urlencoded; formData() parses it.
  const form = await request.formData();
  const contact = String(form.get('contact') ?? '');
  const number = CONTACTS[contact];

  const { VoiceResponse } = twilio.twiml;
  const response = new VoiceResponse();

  if (number) {
    const dial = response.dial({ callerId: twilioConfig.callerId });
    dial.number(number);
  } else {
    response.say('Sorry, no valid contact was selected. Goodbye.');
    response.hangup();
  }

  return new Response(response.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
