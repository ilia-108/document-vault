import { createContext, useContext } from 'react';
export interface AuthUser {
  id: string;
  email: string;
}
export const AuthContext = createContext<{
  user: AuthUser | null;
  enabled: boolean;
  logout(): Promise<void>;
}>({ user: null, enabled: false, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);
