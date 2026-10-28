import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, errorMessage, requestJson } from '@/services/api';
import { Icon } from '@/components/Icon';
import { useAppDispatch } from '@/store/hooks';
import { clearRecords } from '@/store/modules/records/slice';
import { clearDocumentVersions } from '@/store/modules/documentVersions/slice';
import { AuthContext } from './context';
import type { AuthUser } from './context';

function parseUser(value: unknown): AuthUser {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    !('email' in value) ||
    typeof value.id !== 'string' ||
    typeof value.email !== 'string'
  )
    throw new Error('Invalid account response');
  return { id: value.id, email: value.email };
}
export function AuthGate({ children }: { children: ReactNode }) {
  const enabled = window.runtimeConfig?.MODE === 'server';
  const dispatch = useAppDispatch();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [emailMode, setEmailMode] = useState('resend');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void requestJson(
      'auth/config',
      value => {
        if (
          value &&
          typeof value === 'object' &&
          'emailMode' in value &&
          value.emailMode === 'log'
        )
          return 'log';
        return 'resend';
      },
      { signal: controller.signal }
    )
      .then(setEmailMode)
      .catch(() => {});
    void requestJson('auth/me', parseUser, { signal: controller.signal })
      .then(setUser)
      .catch(error => {
        if (
          !controller.signal.aborted &&
          !(error instanceof ApiError && error.status === 401)
        )
          setError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, retry]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      dispatch(clearRecords());
      dispatch(clearDocumentVersions());
    };
    window.addEventListener('document-vault:session-expired', expired);
    return () =>
      window.removeEventListener('document-vault:session-expired', expired);
  }, [dispatch]);
  const logout = async () => {
    await requestJson('auth/logout', value => value, { body: {} });
    setUser(null);
    dispatch(clearRecords());
    dispatch(clearDocumentVersions());
  };
  if (!enabled) return children;
  if (loading || error)
    return (
      <main className='startup'>
        <Icon name='shield' size={32} />
        <h1>Document Vault</h1>
        <p>{error || 'Opening your secure workspace…'}</p>
        {error && (
          <button
            className='button'
            onClick={() => setRetry(value => value + 1)}
          >
            Try again
          </button>
        )}
      </main>
    );
  return (
    <AuthContext.Provider value={{ user, enabled, logout }}>
      {user ? (
        <Fragment key={user.id}>{children}</Fragment>
      ) : (
        <SignIn emailMode={emailMode} onSignedIn={setUser} />
      )}
    </AuthContext.Provider>
  );
}
function SignIn({
  emailMode,
  onSignedIn,
}: {
  emailMode: string;
  onSignedIn(user: AuthUser): void;
}) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!resendAt) return;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      await requestJson('auth/request-code', value => value, {
        body: { email: email.trim() },
      });
      setSent(true);
      setCode('');
      setResendAt(Date.now() + 60000);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className='sign-in-page'>
      <section className='sign-in-card'>
        <span className='brand-mark'>
          <Icon name='document' size={26} />
        </span>
        <div className='eyebrow'>DOCUMENT VAULT</div>
        <h1>{sent ? 'Check your inbox' : 'Your documents. Preserved.'}</h1>
        <p>
          {sent
            ? `Enter the six-digit code sent to ${email.trim()}. It expires in 10 minutes.`
            : 'Sign in with your email. No password to remember.'}
        </p>
        {emailMode === 'log' && (
          <div className='development-note'>
            Local development: the sign-in code is printed in the API terminal.
            No email is sent.
          </div>
        )}
        <form
          onSubmit={async event => {
            event.preventDefault();
            if (!sent) {
              await sendCode();
              return;
            }
            setBusy(true);
            setError('');
            try {
              const user = await requestJson('auth/verify-code', parseUser, {
                body: { email: email.trim(), code },
              });
              onSignedIn(user);
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {sent ? (
            <label>
              Sign-in code
              <input
                autoFocus
                inputMode='numeric'
                autoComplete='one-time-code'
                pattern='[0-9]{6}'
                maxLength={6}
                minLength={6}
                required
                value={code}
                onChange={event =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
              />
            </label>
          ) : (
            <label>
              Email address
              <input
                type='email'
                autoComplete='email'
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p className='error-text' role='alert'>
              {error}
            </p>
          )}
          <button className='button primary' type='submit' disabled={busy}>
            {busy
              ? 'Please wait…'
              : sent
                ? 'Open my library'
                : 'Send sign-in code'}
            <Icon name='arrow' size={16} />
          </button>
        </form>
        {sent && (
          <div className='sign-in-options'>
            <button
              className='text-button'
              disabled={busy || remaining > 0}
              onClick={() => void sendCode()}
            >
              {remaining > 0 ? `Resend in ${remaining}s` : 'Send another code'}
            </button>
            <button
              className='text-button'
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode('');
                setError('');
              }}
            >
              Use another email
            </button>
          </div>
        )}
        <footer>
          <Icon name='shield' size={14} />
          Private files. Immutable versions.
        </footer>
      </section>
    </main>
  );
}
