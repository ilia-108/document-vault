import { useState } from 'react';
import { useAuth } from './context';
export function AccountControl() {
  const { user, enabled, logout } = useAuth();
  const [error, setError] = useState('');
  if (!enabled || !user)
    return (
      <span className='avatar' aria-label='Personal workspace'>
        IG
      </span>
    );
  return (
    <div className='account-control'>
      <span title={user.email}>{user.email}</span>
      <button
        className='text-button'
        onClick={() =>
          void logout().catch(() => setError('Cannot sign out; try again'))
        }
      >
        Sign out
      </button>
      {error && (
        <span className='error-text' role='alert'>
          {error}
        </span>
      )}
    </div>
  );
}
