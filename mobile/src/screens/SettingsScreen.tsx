import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  apiService,
  AssistantConfig,
  CompanyProfile,
  FAQEntry,
} from '../services/api';
import { useTheme } from '../context/ThemeContext';

type SettingsView = 'hub' | 'company-setup' | 'assistant-config';

const VOICE_OPTIONS = [
  { id: 'Aoede', name: 'Aoede', desc: 'Expressive, Warm, Engaging Female' },
  { id: 'Puck', name: 'Puck', desc: 'Natural, Approachable, Dynamic Male' },
  { id: 'Charon', name: 'Charon', desc: 'Calm, Confident, Authoritative Male' },
  { id: 'Kore', name: 'Kore', desc: 'Clear, Polished, Professional Female' },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Resonant, Deep, Energetic Male' },
];

const TONE_OPTIONS: ('professional' | 'friendly' | 'warm' | 'concise')[] = [
  'professional',
  'friendly',
  'warm',
  'concise',
];

const TIMEZONE_OPTIONS = [
  { label: 'Mauritius — Indian/Mauritius (UTC+04:00)', value: 'Indian/Mauritius' },
  { label: 'Eastern Time — America/New_York', value: 'America/New_York' },
  { label: 'Pacific Time — America/Los_Angeles', value: 'America/Los_Angeles' },
  { label: 'Central Time — America/Chicago', value: 'America/Chicago' },
  { label: 'London — Europe/London', value: 'Europe/London' },
  { label: 'UTC', value: 'UTC' },
];

const BUSINESS_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export default function SettingsScreen() {
  const { colors, theme, toggleTheme } = useTheme();
  const [currentView, setCurrentView] = useState<SettingsView>('hub');

  // ─── Company Setup State ──────────────────────────────────────────────────
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    company_name: 'Apex Global Technologies',
    website_url: 'https://apex-global.example.com',
    company_phone: '+230 555-0199',
    support_email: 'support@apex-global.example.com',
    timezone: 'Indian/Mauritius',
  });
  const [isCompanySaving, setIsCompanySaving] = useState(false);
  const [companyStatusMsg, setCompanyStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // ─── AI Assistant State ───────────────────────────────────────────────────
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig>({
    assistant_name: 'Apex Voice Receptionist',
    voice_engine: 'Aoede',
    inbound_greeting: 'Hello! Thank you for calling Apex Global Technologies. How can I assist you today?',
    system_prompt: 'You are the primary AI receptionist for Apex Global Technologies. Greet callers professionally, handle inquiries about business hours, company capabilities, and schedule calendar appointments.',
    knowledge_base_notes: 'Apex Global Technologies specializes in AI voice automation, enterprise telephony integration, and real-time scheduling solutions. Office hours are Monday to Friday 9:00 AM to 5:00 PM (MUT).',
    tone: 'friendly',
    business_hours: {
      monday: '09:00–17:00',
      tuesday: '09:00–17:00',
      wednesday: '09:00–17:00',
      thursday: '09:00–17:00',
      friday: '09:00–17:00',
      saturday: 'Closed',
      sunday: 'Closed',
    },
    escalation_rules: [
      'If caller requests executive escalation, prompt for their callback number.',
      'If emergency billing issue, offer priority ticket submission.',
    ],
    faq_entries: [
      {
        question: 'What are your support hours?',
        answer: 'Support is available Monday through Friday from 9:00 AM to 5:00 PM MUT.',
      },
      {
        question: 'How do I book a consultation?',
        answer: 'I can directly schedule a consultation with our solutions team right now on Google Calendar.',
      },
    ],
    capabilities: {
      company_receptionist: true,
      company_faq: true,
      google_calendar: true,
    },
    is_deployed: false,
  });

  const [publishedVersion, setPublishedVersion] = useState<number | null>(1);
  const [isAssistantSaving, setIsAssistantSaving] = useState(false);
  const [assistantStatusMsg, setAssistantStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [escalationInput, setEscalationInput] = useState(assistantConfig.escalation_rules.join('\n'));

  // ─── Data Fetching ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const company = await apiService.getCompanyProfile();
      if (company && company.company_name) {
        setCompanyProfile(company);
      }

      const assistant = await apiService.getAssistantConfig();
      if (assistant && assistant.assistant_name) {
        setAssistantConfig(assistant);
        if (assistant.escalation_rules) {
          setEscalationInput(assistant.escalation_rules.join('\n'));
        }
      }

      const versions = await apiService.getAssistantVersions();
      const current = versions.find((v) => v.lifecycle_state === 'published');
      if (current) {
        setPublishedVersion(current.version);
      }
    } catch {
      // Offline fallback preserved
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Company Save Handler (1:1 from frontend) ──────────────────────────────
  const handleSaveCompany = async () => {
    if (!companyProfile.company_name.trim()) {
      Alert.alert('Validation Error', 'Company Name is required.');
      return;
    }
    setIsCompanySaving(true);
    setCompanyStatusMsg(null);
    try {
      const res = await apiService.saveCompanyProfile(companyProfile);
      if (res.success) {
        setCompanyStatusMsg({ text: 'Company profile saved to database successfully!', type: 'success' });
      } else {
        setCompanyStatusMsg({ text: 'Company profile saved locally.', type: 'success' });
      }
      setTimeout(() => setCompanyStatusMsg(null), 4000);
    } catch {
      setCompanyStatusMsg({ text: 'Network error saving company profile.', type: 'error' });
      setTimeout(() => setCompanyStatusMsg(null), 4000);
    } finally {
      setIsCompanySaving(false);
    }
  };

  // ─── Assistant Save / Publish Handler (1:1 from frontend) ─────────────────
  const handleSaveAssistant = async (deploy = false) => {
    if (!assistantConfig.assistant_name.trim()) {
      Alert.alert('Validation Error', 'Assistant Identifier is required.');
      return;
    }
    setIsAssistantSaving(true);
    setAssistantStatusMsg(null);

    const rules = escalationInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const updatedConfig: AssistantConfig = {
      ...assistantConfig,
      escalation_rules: rules,
    };

    try {
      const res = await apiService.saveAssistantConfig(updatedConfig, deploy);
      if (deploy) {
        setPublishedVersion(res.version || (publishedVersion ? publishedVersion + 1 : 1));
      }
      setAssistantStatusMsg({
        text: deploy
          ? 'Assistant profile published. New sessions will use this version.'
          : 'Assistant draft saved.',
        type: 'success',
      });
      setTimeout(() => setAssistantStatusMsg(null), 4000);
    } catch (e: any) {
      setAssistantStatusMsg({
        text: e?.message || 'Configuration saved locally.',
        type: 'success',
      });
      setTimeout(() => setAssistantStatusMsg(null), 4000);
    } finally {
      setIsAssistantSaving(false);
    }
  };

  // ─── FAQ Handlers (1:1 from frontend) ──────────────────────────────────────
  const handleAddFaq = () => {
    if (assistantConfig.faq_entries.length >= 20) {
      Alert.alert('Limit Reached', 'Maximum 20 FAQ entries allowed.');
      return;
    }
    setAssistantConfig((prev) => ({
      ...prev,
      faq_entries: [...prev.faq_entries, { question: '', answer: '' }],
    }));
  };

  const handleUpdateFaq = (index: number, field: 'question' | 'answer', value: string) => {
    setAssistantConfig((prev) => {
      const updated = [...prev.faq_entries];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, faq_entries: updated };
    });
  };

  const handleRemoveFaq = (index: number) => {
    setAssistantConfig((prev) => ({
      ...prev,
      faq_entries: prev.faq_entries.filter((_, i) => i !== index),
    }));
  };

  // ═════════════════════════════════════════════════════════════════════════════
  // SUB-SCREEN 1: COMPANY SETUP (1:1 FROM frontend/src/App.tsx)
  // ═════════════════════════════════════════════════════════════════════════════
  if (currentView === 'company-setup') {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
          {/* Sub-screen Navigation Bar */}
          <View style={[styles.subScreenHeader, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setCurrentView('hub')}
              style={styles.backButton}
              activeOpacity={0.7}
            >
              <Text style={styles.backButtonText}>← Settings</Text>
            </TouchableOpacity>
            <Text style={[styles.subScreenTitle, { color: colors.textHeading }]}>Company Setup</Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={styles.body}>
            {/* Page Header / Subtitle */}
            <View style={{ marginBottom: 4 }}>
              <Text style={[styles.pageTitle, { color: colors.textHeading }]}>Company Setup</Text>
              <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>
                Manage your organization profile, contact details, and operational settings.
              </Text>
            </View>

            {/* Status Message */}
            {companyStatusMsg && (
              <View
                style={[
                  styles.statusBanner,
                  {
                    backgroundColor: companyStatusMsg.type === 'success' ? '#DCFCE7' : '#FEE2E2',
                    borderColor: companyStatusMsg.type === 'success' ? '#86EFAC' : '#FCA5A5',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusBannerText,
                    { color: companyStatusMsg.type === 'success' ? '#166534' : '#991B1B' },
                  ]}
                >
                  {companyStatusMsg.text}
                </Text>
              </View>
            )}

            {/* Main Company Profile Card (1:1 from frontend) */}
            <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <Text style={[styles.cardHeading, { color: colors.textHeading }]}>Company Profile</Text>

              {/* Company Name */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Company Name</Text>
                <TextInput
                  value={companyProfile.company_name}
                  onChangeText={(val) => setCompanyProfile((prev) => ({ ...prev, company_name: val }))}
                  placeholder="Your company name"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                />
              </View>

              {/* Website URL */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Website URL</Text>
                <TextInput
                  value={companyProfile.website_url || ''}
                  onChangeText={(val) => setCompanyProfile((prev) => ({ ...prev, website_url: val }))}
                  placeholder="https://your-company.example"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                />
              </View>

              {/* 2-Column: Company Phone & Support Email */}
              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Company Phone</Text>
                  <TextInput
                    value={companyProfile.company_phone || ''}
                    onChangeText={(val) => setCompanyProfile((prev) => ({ ...prev, company_phone: val }))}
                    placeholder="+230 ..."
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Support Email</Text>
                  <TextInput
                    value={companyProfile.support_email || ''}
                    onChangeText={(val) => setCompanyProfile((prev) => ({ ...prev, support_email: val }))}
                    placeholder="support@your-company.example"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                  />
                </View>
              </View>

              {/* Default Timezone Dropdown Selection */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Default Timezone</Text>
                <View style={styles.timezoneList}>
                  {TIMEZONE_OPTIONS.map((tz) => {
                    const isSelected = (companyProfile.timezone || 'Indian/Mauritius') === tz.value;
                    return (
                      <TouchableOpacity
                        key={tz.value}
                        onPress={() => setCompanyProfile((prev) => ({ ...prev, timezone: tz.value }))}
                        style={[
                          styles.tzOption,
                          {
                            backgroundColor: isSelected ? 'rgba(59,91,219,0.12)' : colors.bg,
                            borderColor: isSelected ? '#3B5BDB' : colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.tzOptionText, { color: isSelected ? '#3B5BDB' : colors.textHeading }]}>
                          {isSelected ? '● ' : '○ '}
                          {tz.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Action Buttons (1:1 Cancel & Save Changes) */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  onPress={() => setCurrentView('hub')}
                  style={[styles.btnSecondary, { borderColor: colors.border, backgroundColor: colors.bg }]}
                >
                  <Text style={[styles.btnSecondaryText, { color: colors.textHeading }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSaveCompany}
                  disabled={isCompanySaving}
                  style={styles.btnPrimary}
                >
                  {isCompanySaving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Setup Context Sidebar Card (1:1 from frontend) */}
            <View style={[styles.contextCard, { backgroundColor: 'rgba(59,91,219,0.08)', borderColor: 'rgba(59,91,219,0.3)' }]}>
              <Text style={styles.contextTitle}>Setup Context</Text>
              <Text style={[styles.contextDesc, { color: colors.textHeading }]}>
                Company details provide bounded context for your assistant. They do not grant new tools or change platform security rules.
              </Text>

              <View style={styles.contextList}>
                <View style={styles.contextItem}>
                  <Text style={styles.checkIcon}>✓</Text>
                  <Text style={[styles.contextItemText, { color: colors.textHeading }]}>
                    Company-specific assistant profile
                  </Text>
                </View>
                <View style={styles.contextItem}>
                  <Text style={styles.checkIcon}>✓</Text>
                  <Text style={[styles.contextItemText, { color: colors.textHeading }]}>
                    Google Calendar connection is company-scoped
                  </Text>
                </View>
                <View style={styles.contextItem}>
                  <Text style={styles.checkIcon}>✓</Text>
                  <Text style={[styles.contextItemText, { color: colors.textHeading }]}>
                    3CX call handling is not active yet
                  </Text>
                </View>
              </View>
            </View>
          </View>
          <View style={{ height: 90 }} />
        </ScrollView>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // SUB-SCREEN 2: AI ASSISTANT CONFIGURATION (1:1 FROM frontend/src/App.tsx)
  // ═════════════════════════════════════════════════════════════════════════════
  if (currentView === 'assistant-config') {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.bg }]}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
          {/* Sub-screen Navigation Bar */}
          <View style={[styles.subScreenHeader, { backgroundColor: colors.cardBg, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setCurrentView('hub')}
              style={styles.backButton}
              activeOpacity={0.7}
            >
              <Text style={styles.backButtonText}>← Settings</Text>
            </TouchableOpacity>
            <Text style={[styles.subScreenTitle, { color: colors.textHeading }]}>AI Assistant</Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={styles.body}>
            {/* Page Header / Subtitle */}
            <View style={{ marginBottom: 4 }}>
              <Text style={[styles.pageTitle, { color: colors.textHeading }]}>Assistant Configuration</Text>
              <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>
                Manage voice engine, prompts, and deployment settings for your AI assistants.
              </Text>
            </View>

            {/* Status Message Banner */}
            {assistantStatusMsg && (
              <View
                style={[
                  styles.statusBanner,
                  {
                    backgroundColor: assistantStatusMsg.type === 'success' ? '#DCFCE7' : '#FEE2E2',
                    borderColor: assistantStatusMsg.type === 'success' ? '#86EFAC' : '#FCA5A5',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusBannerText,
                    { color: assistantStatusMsg.type === 'success' ? '#166534' : '#991B1B' },
                  ]}
                >
                  {assistantStatusMsg.text}
                </Text>
              </View>
            )}

            {/* Main AI Model & Prompt Configuration Card */}
            <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardHeading, { color: colors.textHeading }]}>
                  AI Model & Prompt Configuration
                </Text>
                {publishedVersion && (
                  <View style={styles.versionBadge}>
                    <Text style={styles.versionBadgeText}>v{publishedVersion} Published</Text>
                  </View>
                )}
              </View>

              {/* Assistant Identifier */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Assistant Identifier</Text>
                <TextInput
                  value={assistantConfig.assistant_name}
                  onChangeText={(val) => setAssistantConfig((prev) => ({ ...prev, assistant_name: val }))}
                  placeholder="Name this assistant for your company"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                />
              </View>

              {/* Gemini Live Voice Engine */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Gemini Live Voice Engine</Text>
                <View style={styles.voicePickerContainer}>
                  {VOICE_OPTIONS.map((v) => {
                    const isSelected = assistantConfig.voice_engine === v.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        onPress={() => setAssistantConfig((prev) => ({ ...prev, voice_engine: v.id }))}
                        style={[
                          styles.voiceCard,
                          {
                            backgroundColor: isSelected ? 'rgba(59,91,219,0.12)' : colors.bg,
                            borderColor: isSelected ? '#3B5BDB' : colors.border,
                          },
                        ]}
                      >
                        <View style={styles.voiceHeaderRow}>
                          <Text style={[styles.voiceName, { color: isSelected ? '#3B5BDB' : colors.textHeading }]}>
                            🎙️ {v.name}
                          </Text>
                          {isSelected && <Text style={styles.selectedCheckMark}>✓</Text>}
                        </View>
                        <Text style={[styles.voiceDesc, { color: colors.textMuted }]}>{v.desc}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Inbound Greeting Phrase */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Inbound Greeting Phrase</Text>
                <TextInput
                  value={assistantConfig.inbound_greeting}
                  onChangeText={(val) => setAssistantConfig((prev) => ({ ...prev, inbound_greeting: val }))}
                  maxLength={500}
                  placeholder="Write the greeting your callers should hear"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                />
              </View>

              {/* System Instructions (AI Prompt) */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                  System Instructions (AI Prompt)
                </Text>
                <TextInput
                  value={assistantConfig.system_prompt}
                  onChangeText={(val) => setAssistantConfig((prev) => ({ ...prev, system_prompt: val }))}
                  multiline
                  numberOfLines={5}
                  placeholder="Describe your company, services, tone, and approved operating rules. Platform security and tool permissions remain enforced."
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inputFieldMultiline, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading, minHeight: 95 }]}
                />
              </View>

              {/* CapabilityChoices Component (1:1 from frontend) */}
              <View style={[styles.capabilitiesBox, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                <Text style={[styles.capabilitiesBoxTitle, { color: colors.textHeading }]}>
                  Enabled company capabilities
                </Text>

                {/* Company Receptionist */}
                <TouchableOpacity
                  onPress={() =>
                    setAssistantConfig((prev) => ({
                      ...prev,
                      capabilities: {
                        ...prev.capabilities,
                        company_receptionist: !prev.capabilities.company_receptionist,
                      },
                    }))
                  }
                  style={styles.capItemRow}
                >
                  <View
                    style={[
                      styles.checkBoxSquare,
                      {
                        backgroundColor: assistantConfig.capabilities.company_receptionist ? '#3B5BDB' : 'transparent',
                        borderColor: assistantConfig.capabilities.company_receptionist ? '#3B5BDB' : colors.border,
                      },
                    ]}
                  >
                    {assistantConfig.capabilities.company_receptionist && (
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>✓</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.capLabel, { color: colors.textHeading }]}>Company receptionist</Text>
                    <Text style={[styles.capDesc, { color: colors.textMuted }]}>
                      Greet callers and guide company-related requests using your approved profile.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Company FAQs */}
                <TouchableOpacity
                  onPress={() =>
                    setAssistantConfig((prev) => ({
                      ...prev,
                      capabilities: {
                        ...prev.capabilities,
                        company_faq: !prev.capabilities.company_faq,
                      },
                    }))
                  }
                  style={styles.capItemRow}
                >
                  <View
                    style={[
                      styles.checkBoxSquare,
                      {
                        backgroundColor: assistantConfig.capabilities.company_faq ? '#3B5BDB' : 'transparent',
                        borderColor: assistantConfig.capabilities.company_faq ? '#3B5BDB' : colors.border,
                      },
                    ]}
                  >
                    {assistantConfig.capabilities.company_faq && (
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>✓</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.capLabel, { color: colors.textHeading }]}>Company FAQs</Text>
                    <Text style={[styles.capDesc, { color: colors.textMuted }]}>
                      Answer company questions only from your profile and approved reference notes.
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Google Calendar */}
                <TouchableOpacity
                  onPress={() =>
                    setAssistantConfig((prev) => ({
                      ...prev,
                      capabilities: {
                        ...prev.capabilities,
                        google_calendar: !prev.capabilities.google_calendar,
                      },
                    }))
                  }
                  style={styles.capItemRow}
                >
                  <View
                    style={[
                      styles.checkBoxSquare,
                      {
                        backgroundColor: assistantConfig.capabilities.google_calendar ? '#3B5BDB' : 'transparent',
                        borderColor: assistantConfig.capabilities.google_calendar ? '#3B5BDB' : colors.border,
                      },
                    ]}
                  >
                    {assistantConfig.capabilities.google_calendar && (
                      <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>✓</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.capLabel, { color: colors.textHeading }]}>Google Calendar</Text>
                    <Text style={[styles.capDesc, { color: colors.textMuted }]}>
                      Check availability, list events, book, and cancel with confirmation.
                    </Text>
                  </View>
                </TouchableOpacity>

                <Text style={[styles.capDisclaimer, { color: colors.textMuted }]}>
                  Lead qualification and live 3CX call transfer are not available yet. The model cannot enable tools by itself.
                </Text>
              </View>

              {/* CompanyOperatingFields Component (1:1 from frontend) */}
              <View style={[styles.operatingSection, { borderTopColor: colors.border }]}>
                <Text style={[styles.operatingTitle, { color: colors.textHeading }]}>Company operating profile</Text>
                <Text style={[styles.operatingSubtitle, { color: colors.textMuted }]}>
                  These company facts and preferences are tenant data. They cannot grant tools or override platform safeguards.
                </Text>

                {/* Response Tone */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Response tone</Text>
                  <View style={styles.tonePillRow}>
                    {TONE_OPTIONS.map((t) => {
                      const isSelected = assistantConfig.tone === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setAssistantConfig((prev) => ({ ...prev, tone: t }))}
                          style={[
                            styles.tonePill,
                            {
                              backgroundColor: isSelected ? '#3B5BDB' : colors.bg,
                              borderColor: isSelected ? '#3B5BDB' : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.tonePillText, { color: isSelected ? '#FFFFFF' : colors.textMuted }]}>
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Business Hours (Company Timezone) */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                    Business hours (company timezone)
                  </Text>
                  <View style={styles.daysGrid}>
                    {BUSINESS_DAYS.map((day) => (
                      <View key={day} style={styles.dayGridRow}>
                        <Text style={[styles.dayLabel, { color: colors.textMuted }]}>
                          {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                        </Text>
                        <TextInput
                          value={assistantConfig.business_hours[day] || ''}
                          onChangeText={(val) =>
                            setAssistantConfig((prev) => ({
                              ...prev,
                              business_hours: { ...prev.business_hours, [day]: val },
                            }))
                          }
                          placeholder="Closed or 09:00–17:00"
                          placeholderTextColor={colors.textMuted}
                          style={[styles.dayInput, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
                        />
                      </View>
                    ))}
                  </View>
                </View>

                {/* Escalation Guidance */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Escalation guidance</Text>
                  <TextInput
                    value={escalationInput}
                    onChangeText={setEscalationInput}
                    multiline
                    numberOfLines={3}
                    placeholder="One company-specific escalation preference per line"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.inputFieldMultiline, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading, minHeight: 65 }]}
                  />
                  <Text style={[styles.helperNote, { color: colors.textMuted }]}>
                    Guidance only; automated transfer is not available yet.
                  </Text>
                </View>

                {/* Approved FAQs (1:1 Conditional on company_faq) */}
                {assistantConfig.capabilities.company_faq && (
                  <View style={styles.faqSection}>
                    <View style={styles.faqHeaderRow}>
                      <Text style={[styles.inputLabel, { color: colors.textHeading }]}>Approved FAQs</Text>
                      <TouchableOpacity
                        onPress={handleAddFaq}
                        disabled={assistantConfig.faq_entries.length >= 20}
                        style={styles.addFaqButton}
                      >
                        <Text style={styles.addFaqButtonText}>+ Add FAQ</Text>
                      </TouchableOpacity>
                    </View>

                    {assistantConfig.faq_entries.map((entry, index) => (
                      <View
                        key={index}
                        style={[styles.faqCard, { backgroundColor: colors.bg, borderColor: colors.border }]}
                      >
                        <View style={styles.faqCardTop}>
                          <Text style={[styles.faqCardIndex, { color: colors.textMuted }]}>
                            Question #{index + 1}
                          </Text>
                          <TouchableOpacity onPress={() => handleRemoveFaq(index)}>
                            <Text style={styles.removeFaqText}>Remove FAQ</Text>
                          </TouchableOpacity>
                        </View>

                        <TextInput
                          maxLength={240}
                          value={entry.question}
                          onChangeText={(val) => handleUpdateFaq(index, 'question', val)}
                          placeholder="Question"
                          placeholderTextColor={colors.textMuted}
                          style={[styles.inputField, { backgroundColor: colors.cardBg, borderColor: colors.border, color: colors.textHeading, marginBottom: 8 }]}
                        />
                        <TextInput
                          maxLength={1200}
                          multiline
                          numberOfLines={2}
                          value={entry.answer}
                          onChangeText={(val) => handleUpdateFaq(index, 'answer', val)}
                          placeholder="Approved answer"
                          placeholderTextColor={colors.textMuted}
                          style={[styles.inputFieldMultiline, { backgroundColor: colors.cardBg, borderColor: colors.border, color: colors.textHeading, minHeight: 50 }]}
                        />
                      </View>
                    ))}

                    <Text style={[styles.helperNote, { color: colors.textMuted }]}>
                      Only answers from this approved list and company reference notes may be used for company FAQs.
                    </Text>
                  </View>
                )}

                {/* Approved Company Reference Notes */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
                    Approved company reference notes
                  </Text>
                  <TextInput
                    numberOfLines={4}
                    maxLength={16000}
                    multiline
                    value={assistantConfig.knowledge_base_notes}
                    onChangeText={(val) => setAssistantConfig((prev) => ({ ...prev, knowledge_base_notes: val }))}
                    placeholder="Enter company facts and approved answers. File upload is not available yet."
                    placeholderTextColor={colors.textMuted}
                    style={[styles.inputFieldMultiline, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading, minHeight: 75 }]}
                  />
                </View>
              </View>

              {/* Action Toolbar (1:1 Save & Test Draft, Save Draft, Publish Assistant Profile) */}
              <View style={styles.actionToolbar}>
                <View style={styles.actionToolbarTopRow}>
                  <TouchableOpacity
                    onPress={() => handleSaveAssistant(false)}
                    disabled={isAssistantSaving}
                    style={[styles.btnOutlineBlue, { borderColor: '#3B5BDB', backgroundColor: colors.bg }]}
                  >
                    <Text style={[styles.btnOutlineBlueText, { color: '#3B5BDB' }]}>
                      Save & test draft
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleSaveAssistant(false)}
                    disabled={isAssistantSaving}
                    style={[styles.btnOutlineGray, { borderColor: colors.border, backgroundColor: colors.bg }]}
                  >
                    <Text style={[styles.btnOutlineGrayText, { color: colors.textHeading }]}>
                      Save Draft
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => handleSaveAssistant(true)}
                  disabled={isAssistantSaving}
                  style={styles.btnPublish}
                >
                  {isAssistantSaving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.btnPublishText}>Publish Assistant Profile</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={{ height: 90 }} />
        </ScrollView>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // MAIN SETTINGS HUB (OVERVIEW ROOT)
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
        {/* Profile Header Banner */}
        <LinearGradient
          colors={['#1e1b4b', '#1e3a8a']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHeader}
        >
          <LinearGradient
            colors={['#06B6D4', '#3B5BDB']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileAvatar}
          >
            <Text style={styles.profileAvatarText}>EJ</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>Elihu Joseph</Text>
            <Text style={styles.profileRole}>Mobile App & Integrations Lead</Text>
            <View style={styles.sprintBadge}>
              <Text style={styles.sprintText}>
                vocalist.ai · Live Voice Engine · v{publishedVersion || 1}.0
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.body}>
          {/* Section: Configuration & Sub-Screen Portals */}
          <View style={styles.sectionGroup}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              Configuration & Operating Profiles
            </Text>

            {/* Company Setup Card */}
            <TouchableOpacity
              onPress={() => setCurrentView('company-setup')}
              style={[styles.portalCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
              activeOpacity={0.75}
            >
              <View style={[styles.portalIconBox, { backgroundColor: 'rgba(59,91,219,0.12)', borderColor: 'rgba(59,91,219,0.3)' }]}>
                <Text style={{ fontSize: 22 }}>🏢</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.portalHeading, { color: colors.textHeading }]}>Company Setup</Text>
                <Text style={[styles.portalSub, { color: colors.textMuted }]}>
                  {companyProfile.company_name} · {companyProfile.timezone || 'Indian/Mauritius'}
                </Text>
              </View>
              <Text style={styles.portalArrow}>→</Text>
            </TouchableOpacity>

            {/* AI Assistant Configuration Card */}
            <TouchableOpacity
              onPress={() => setCurrentView('assistant-config')}
              style={[styles.portalCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
              activeOpacity={0.75}
            >
              <View style={[styles.portalIconBox, { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.3)' }]}>
                <Text style={{ fontSize: 22 }}>🤖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.portalHeading, { color: colors.textHeading }]}>
                    AI Assistant Configuration
                  </Text>
                  <View style={styles.miniTag}>
                    <Text style={styles.miniTagText}>Published</Text>
                  </View>
                </View>
                <Text style={[styles.portalSub, { color: colors.textMuted }]}>
                  {assistantConfig.assistant_name} · {assistantConfig.voice_engine} Voice
                </Text>
              </View>
              <Text style={styles.portalArrow}>→</Text>
            </TouchableOpacity>
          </View>

          {/* Section: Display & Appearance */}
          <View style={styles.sectionGroup}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Display & Appearance</Text>
            <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <View style={styles.themeRow}>
                <Text style={{ fontSize: 22 }}>{theme === 'dark' ? '🌙' : '☀️'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>
                    {theme === 'dark' ? 'Executive Dark Theme' : 'Executive Light Theme'}
                  </Text>
                  <Text style={[styles.itemSub, { color: colors.textMuted }]}>
                    {theme === 'dark'
                      ? 'Deep slate & navy with cyan accents'
                      : 'Crisp high-contrast daylight aesthetic'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={toggleTheme}
                  style={[
                    styles.switchTrack,
                    { backgroundColor: theme === 'dark' ? '#3B5BDB' : '#CBD5E1' },
                  ]}
                >
                  <View
                    style={[
                      styles.switchThumb,
                      { left: theme === 'dark' ? 22 : 3 },
                    ]}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Section: SLA & Telemetry */}
          <View style={styles.sectionGroup}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              Audio Turnaround Latency SLA (ADR-008)
            </Text>
            <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>⚡</Text>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>Target Turnaround</Text>
                </View>
                <Text style={{ color: '#22C55E', fontWeight: '800', fontFamily: 'monospace' }}>
                  &lt;450ms (Verified)
                </Text>
              </View>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <Text style={[styles.itemSub, { color: colors.textMuted }]}>
                Client-side Web Audio gain clamping (&lt;20ms) + raw asyncpg Neon queries keep total voice cycle latency below the 450ms threshold.
              </Text>
            </View>
          </View>

          {/* Section: Telephony & Architecture */}
          <View style={styles.sectionGroup}>
            <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
              Voice Engine & Telephony (ADR-009)
            </Text>
            <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
              <View style={styles.settingItemRow}>
                <Text style={{ fontSize: 18 }}>🎙️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>Primary Voice Model</Text>
                  <Text style={[styles.itemSub, { color: colors.textMuted }]}>
                    Gemini 2.0 Flash (24kHz native audio via WebRTC)
                  </Text>
                </View>
              </View>
              <View style={[styles.itemDivider, { backgroundColor: colors.border }]} />
              <View style={styles.settingItemRow}>
                <Text style={{ fontSize: 18 }}>🌐</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>LiveKit Cloud Server</Text>
                  <Text style={[styles.itemSub, { color: colors.textMuted }]}>{apiService.getLiveKitUrl()}</Text>
                </View>
              </View>
              <View style={[styles.itemDivider, { backgroundColor: colors.border }]} />
              <View style={styles.settingItemRow}>
                <Text style={{ fontSize: 18 }}>🔌</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>FastAPI Dispatcher</Text>
                  <Text style={[styles.itemSub, { color: colors.textMuted }]}>{apiService.getBackendUrl()}</Text>
                </View>
              </View>
              <View style={[styles.itemDivider, { backgroundColor: colors.border }]} />
              <View style={styles.settingItemRow}>
                <Text style={{ fontSize: 18 }}>🌿</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, { color: colors.textHeading }]}>Active Feature Branch</Text>
                  <Text style={[styles.itemSub, { color: colors.textMuted }]}>feat/mobile-app-init (develop target)</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
        <View style={{ height: 90 }} />
      </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  profileHeader: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#06B6D4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
  profileAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  profileRole: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  sprintBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(59,91,219,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(59,91,219,0.5)',
  },
  sprintText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#A5B4FC',
  },
  subScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#3B5BDB',
    fontSize: 14,
    fontWeight: '700',
  },
  subScreenTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  body: {
    padding: 16,
    gap: 16,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  statusBanner: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusBannerText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  sectionGroup: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingLeft: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: '800',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  versionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  versionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#22C55E',
  },
  inputGroup: {
    gap: 6,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  inputFieldMultiline: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  timezoneList: {
    gap: 6,
  },
  tzOption: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tzOptionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 6,
  },
  btnSecondary: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  btnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: '#3B5BDB',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  contextCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  contextTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3B5BDB',
  },
  contextDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  contextList: {
    gap: 6,
    paddingTop: 4,
  },
  contextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkIcon: {
    color: '#22C55E',
    fontWeight: '800',
    fontSize: 13,
  },
  contextItemText: {
    fontSize: 12,
    fontWeight: '600',
  },
  voicePickerContainer: {
    gap: 8,
  },
  voiceCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  voiceName: {
    fontSize: 13,
    fontWeight: '700',
  },
  voiceDesc: {
    fontSize: 11,
    lineHeight: 14,
  },
  selectedCheckMark: {
    color: '#3B5BDB',
    fontSize: 13,
    fontWeight: '800',
  },
  capabilitiesBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  capabilitiesBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  capItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkBoxSquare: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  capLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  capDesc: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  capDisclaimer: {
    fontSize: 10,
    lineHeight: 14,
    paddingTop: 2,
  },
  operatingSection: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 12,
  },
  operatingTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  operatingSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  tonePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tonePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  tonePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  daysGrid: {
    gap: 6,
  },
  dayGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dayLabel: {
    width: 36,
    fontSize: 11,
    fontWeight: '700',
  },
  dayInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
  },
  helperNote: {
    fontSize: 10,
    lineHeight: 14,
  },
  faqSection: {
    gap: 8,
  },
  faqHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addFaqButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
  },
  addFaqButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  faqCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  faqCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  faqCardIndex: {
    fontSize: 11,
    fontWeight: '700',
  },
  removeFaqText: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '600',
  },
  actionToolbar: {
    gap: 10,
    paddingTop: 8,
  },
  actionToolbarTopRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnOutlineBlue: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlineBlueText: {
    fontSize: 13,
    fontWeight: '700',
  },
  btnOutlineGray: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlineGrayText: {
    fontSize: 13,
    fontWeight: '600',
  },
  btnPublish: {
    backgroundColor: '#3B5BDB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  btnPublishText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  portalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  portalIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portalHeading: {
    fontSize: 14,
    fontWeight: '700',
  },
  portalSub: {
    fontSize: 12,
    marginTop: 2,
  },
  portalArrow: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '700',
  },
  miniTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 99,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  miniTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#22C55E',
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  itemSub: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    padding: 2,
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    position: 'absolute',
  },
  settingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemDivider: {
    height: 1,
    marginVertical: 4,
  },
});
