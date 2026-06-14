'use server';

// Auth server actions. Running on the server means credentials never sit in
// client JS, and Supabase sets the session cookie via our server client.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Credentials = z.object({
  email: z.email(),
  password: z.string().min(8),
});

function backToLogin(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function login(formData: FormData) {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) backToLogin('Enter a valid email and an 8+ character password.');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) backToLogin(error.message);

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signup(formData: FormData) {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) backToLogin('Enter a valid email and an 8+ character password.');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) backToLogin(error.message);

  // With email confirmation ON (Supabase default), signUp returns no session —
  // the user must click the email link first. With it OFF (handy for dev),
  // a session exists immediately and we can go straight to the app.
  if (data.session) {
    revalidatePath('/', 'layout');
    redirect('/');
  }
  redirect(
    `/login?message=${encodeURIComponent('Account created. Check your email to confirm, then log in.')}`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
