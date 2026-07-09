export type SignupOutcome =
  | 'success'
  | 'invalid_name'
  | 'confirm_email'
  | 'email_taken'
  | 'invalid_email'
  | 'weak_password'
  | 'rate_limited'
  | 'email_send_failed'
  | 'server_error'
  | 'unknown_error';

export type LoginOutcome =
  | 'success'
  | 'wrong_credentials'
  | 'email_not_confirmed'
  | 'wrong_account_type'
  | 'rate_limited'
  | 'server_error'
  | 'unknown_error';

export function mapSignupError(error: unknown): SignupOutcome {
  const e = error as any;
  const code: string = String(e?.code ?? '');
  const status: number = typeof e?.status === 'number' ? e.status : 0;
  const msg: string = String(e?.message ?? '').toLowerCase();

  if (code === 'user_already_exists' ||
      /already.*regist|already.*exist/.test(msg))
    return 'email_taken';
  if (code === 'weak_password')
    return 'weak_password';
  if (code === 'invalid_email' ||
      code === 'email_address_invalid' ||
      code === 'validation_failed')
    return 'invalid_email';
  if (code === 'over_email_send_rate_limit' ||
      code === 'over_request_rate_limit')
    return 'rate_limited';
  if (msg.includes('sending confirmation email'))
    return 'email_send_failed';
  if (status >= 500 ||
      code === 'unexpected_failure' ||
      msg.includes('database error'))
    return 'server_error';

  console.error('[auth] Unmapped signup error:', {
    code, status, message: e?.message
  });
  return 'unknown_error';
}

export function mapLoginError(error: unknown): LoginOutcome {
  const e = error as any;
  const code: string = String(e?.code ?? '');
  const status: number = typeof e?.status === 'number' ? e.status : 0;
  const msg: string = String(e?.message ?? '').toLowerCase();

  if (code === 'email_not_confirmed' || msg.includes('email not confirmed'))
    return 'email_not_confirmed';
  if (code === 'invalid_credentials' || msg.includes('invalid'))
    return 'wrong_credentials';
  if (code === 'over_request_rate_limit')
    return 'rate_limited';
  if (status >= 500 || code === 'unexpected_failure')
    return 'server_error';

  console.error('[auth] Unmapped login error:', {
    code, status, message: e?.message
  });
  return 'unknown_error';
}
