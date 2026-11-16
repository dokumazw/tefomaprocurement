import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../lib/api';
import {
  readStoredSession,
  persistSession,
  clearSession,
  hasStoredSession
} from '../lib/session';
import { logOtpToBrowserConsole } from '../lib/otpDebug';
import { rememberSbuCurrency } from '../lib/sbu';
import http from '../services/http';

const AuthContext = createContext<any>(null);

export function AuthProvider({ children }: any) {
  const [user, setUser] = useState<any>(() => readStoredSession().user);
  // With a stored user the app renders straight away and /auth/me refreshes
  // it in the background; an invalid token still clears the session there.
  const [loading, setLoading] = useState<any>(() => !readStoredSession().user);

  const hydrateFromStorage = useCallback(() => {
    const { user: storedUser } = readStoredSession();
    if (storedUser) {
      setUser(storedUser);
    }
  }, []);

  useEffect(() => {
    // Refresh the cached base currency of the signed-in business unit, so
    // sessions started before it was cached still show the right currency.
    http
      .get('/sbus')
      .then((response) => rememberSbuCurrency(response.data?.data || [], response.data?.current))
      .catch(() => {
        /* the cached or fallback currency stays in use */
      });

    const initAuth = async () => {
      const { token, user: storedUser } = readStoredSession();

      if (storedUser) {
        setUser(storedUser);
      }

      if (token) {
        // The answer applies only to the session that asked. If the user
        // signed out (or in as someone else) while it was on its way, a late
        // reply must not write the old token back and sign them in again.
        const stillCurrent = () => readStoredSession().token === token;
        try {
          const response = await authAPI.getMe();
          if (stillCurrent()) {
            setUser(response.data.user);
            persistSession(token, response.data.user);
          }
        } catch {
          if (stillCurrent()) {
            clearSession();
            setUser(null);
          }
        }
      }

      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email: any, password: any) => {
    const response = await authAPI.login({ email, password });
    if (response.data.requiresOtp) {
      if (response.data.debugOtp) {
        logOtpToBrowserConsole(response.data.email || email, response.data.debugOtp);
      }
      return {
        requiresOtp: true,
        email: response.data.email,
        message: response.data.message,
        debugOtp: response.data.debugOtp
      };
    }

    const { token, user: sessionUser } = response.data;
    if (!token || !sessionUser) {
      throw new Error('Invalid login response');
    }

    persistSession(token, sessionUser);
    setUser(sessionUser);
    return { requiresOtp: false, user: sessionUser };
  };

  const verifyOtp = async (email: any, otp: any) => {
    const response = await authAPI.verifyOtp({ email, otp });
    const { token, user: sessionUser } = response.data;

    if (!token || !sessionUser) {
      throw new Error('Invalid verification response');
    }

    persistSession(token, sessionUser);
    setUser(sessionUser);
    hydrateFromStorage();
    return sessionUser;
  };

  const logout = () => {
    // Ends the session on the server too, so a copy of the token stops
    // working. The token is passed explicitly because the session is cleared
    // straight after, before the request would otherwise pick it up. Signing
    // out locally never waits on the network.
    const { token } = readStoredSession();
    if (token) {
      authAPI.logout(token).catch(() => {
        /* already ended, or offline: the local sign-out still stands */
      });
    }
    clearSession();
    setUser(null);
  };

  const updateUser = (updatedData: any) => {
    const newUser: any = { ...user, ...updatedData };
    const { token } = readStoredSession();
    if (token) {
      persistSession(token, newUser);
    }
    setUser(newUser);
  };

  const value: any = {
    user,
    loading,
    login,
    verifyOtp,
    logout,
    updateUser,
    isAuthenticated: hasStoredSession()
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
