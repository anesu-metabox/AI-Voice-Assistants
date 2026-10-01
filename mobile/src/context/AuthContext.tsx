import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { apiService, AssistantConfig, CompanyProfile, UserAccount } from '../services/api';

interface AuthContextType {
  user: UserAccount | null;
  companyProfile: CompanyProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  assistantConfig: AssistantConfig | null;
  hasCompletedSetup: boolean;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  companyProfile: null,
  isLoading: true,
  isAuthenticated: false,
  assistantConfig: null,
  hasCompletedSetup: false,
  refreshSession: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig | null>(null);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const session = await apiService.checkSession();
      if (session.authenticated && session.user) {
        setUser(session.user);
        const [profile, assistant, versions] = await Promise.all([
          apiService.getCompanyProfile(),
          apiService.getAssistantConfig(),
          apiService.getAssistantVersions(),
        ]);
        setCompanyProfile(profile);
        setAssistantConfig(assistant);
        setHasCompletedSetup(Boolean(
          profile?.company_name?.trim() &&
          assistant?.assistant_name?.trim() &&
          (assistant.is_deployed === true || versions.some((version) => version.lifecycle_state === 'published')),
        ));
      } else {
        setUser(null);
        setCompanyProfile(null);
        setAssistantConfig(null);
        setHasCompletedSetup(false);
      }
    } catch {
      setUser(null);
      setCompanyProfile(null);
      setAssistantConfig(null);
      setHasCompletedSetup(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  // Re-check the server session whenever the native app returns to the
  // foreground. This covers cookie restoration after Android process resume
  // and prevents stale authenticated UI after a server-side expiry/sign-out.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshSession();
      }
    });

    return () => subscription.remove();
  }, []);

  const signOut = async () => {
    try {
      await apiService.signOut();
    } catch {
      // Ignored
    } finally {
      setUser(null);
      setCompanyProfile(null);
      setAssistantConfig(null);
      setHasCompletedSetup(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        companyProfile,
        isLoading,
        isAuthenticated: Boolean(user),
        assistantConfig,
        hasCompletedSetup,
        refreshSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
