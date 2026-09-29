import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiService, CompanyProfile, UserAccount } from '../services/api';

interface AuthContextType {
  user: UserAccount | null;
  companyProfile: CompanyProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasConfiguredCompany: boolean;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  companyProfile: null,
  isLoading: true,
  isAuthenticated: false,
  hasConfiguredCompany: false,
  refreshSession: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const session = await apiService.checkSession();
      if (session.authenticated && session.user) {
        setUser(session.user);
        try {
          const profile = await apiService.getCompanyProfile();
          setCompanyProfile(profile);
        } catch {
          setCompanyProfile(null);
        }
      } else {
        setUser(null);
        setCompanyProfile(null);
      }
    } catch {
      setUser(null);
      setCompanyProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  const signOut = async () => {
    try {
      await apiService.signOut();
    } catch {
      // Ignored
    } finally {
      setUser(null);
      setCompanyProfile(null);
    }
  };

  const hasConfiguredCompany = Boolean(
    companyProfile && companyProfile.company_name && companyProfile.company_name.trim().length > 0
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        companyProfile,
        isLoading,
        isAuthenticated: Boolean(user),
        hasConfiguredCompany,
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
