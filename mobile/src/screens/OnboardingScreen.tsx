import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import VoxiMascot from '../components/VoxiMascot';
import { apiService } from '../services/api';

const VOICE_MODELS = ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'];
const TONES = ['Professional', 'Friendly', 'Warm', 'Concise'];
const CAPABILITIES = [
  { id: 'receptionist', label: 'Company Receptionist', icon: '🏢' },
  { id: 'faqs', label: 'Company FAQs', icon: '💬' },
  { id: 'calendar', label: 'Google Calendar', icon: '📅' },
];
const steps = ['Account', 'Company', 'Assistant'];

function StepIndicator({ current }: { current: number }) {
  return (
    <View style={styles.stepIndicatorRow}>
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'idle';
        return (
          <View key={label} style={styles.stepItemWrapper}>
            <View
              style={[
                styles.stepPill,
                {
                  backgroundColor:
                    state === 'active' ? '#3B5BDB' : state === 'done' ? 'rgba(59,91,219,0.12)' : '#F1F5F9',
                  borderColor:
                    state === 'active' ? 'transparent' : state === 'done' ? 'rgba(59,91,219,0.3)' : '#E8ECF4',
                },
              ]}
            >
              <View
                style={[
                  styles.stepNumberBadge,
                  {
                    backgroundColor:
                      state === 'active'
                        ? 'rgba(255,255,255,0.3)'
                        : state === 'done'
                        ? '#3B5BDB'
                        : '#CBD5E1',
                  },
                ]}
              >
                <Text style={styles.stepNumberText}>{state === 'done' ? '✓' : i + 1}</Text>
              </View>
              <Text
                style={[
                  styles.stepLabelText,
                  {
                    color: state === 'active' ? '#FFFFFF' : state === 'done' ? '#3B5BDB' : '#94A3B8',
                  },
                ]}
              >
                {label}
              </Text>
            </View>
            {i < steps.length - 1 && (
              <View
                style={[
                  styles.stepDivider,
                  { backgroundColor: i < current ? 'rgba(59,91,219,0.3)' : '#E8ECF4' },
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText?: (val: string) => void;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={styles.textInput}
      />
    </View>
  );
}

export default function OnboardingScreen({
  onDone,
  initialStep = 1,
}: {
  onDone: () => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [companyName, setCompanyName] = useState('Apex Global');
  const [website, setWebsite] = useState('https://apexglobal.com');
  const [phone, setPhone] = useState('+1 800 555-0100');
  const [email, setEmail] = useState('support@apexglobal.com');
  const [assistantName, setAssistantName] = useState('Aoede');
  const [selectedModel, setSelectedModel] = useState('Aoede');
  const [greeting, setGreeting] = useState(
    'Thank you for calling Apex Global! How can I assist you today?'
  );
  const [selectedTone, setSelectedTone] = useState('Professional');
  const [capabilities, setCapabilities] = useState(['receptionist', 'faqs', 'calendar']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Preload from database if existing profile is available
    apiService.getCompanyProfile().then((comp) => {
      if (comp) {
        if (comp.company_name) setCompanyName(comp.company_name);
        if (comp.website_url) setWebsite(comp.website_url);
        if (comp.company_phone) setPhone(comp.company_phone);
        if (comp.support_email) setEmail(comp.support_email);
      }
    }).catch(() => {});

    apiService.getAssistantConfig().then((asst) => {
      if (asst) {
        if (asst.assistant_name) setAssistantName(asst.assistant_name);
        if (asst.voice_engine) setSelectedModel(asst.voice_engine);
        if (asst.inbound_greeting) setGreeting(asst.inbound_greeting);
        if (asst.tone) {
          const capTone = asst.tone.charAt(0).toUpperCase() + asst.tone.slice(1);
          setSelectedTone(capTone);
        }
      }
    }).catch(() => {});
  }, []);

  const toggleCapability = (id: string) =>
    setCapabilities((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const handlePublish = async () => {
    try {
      setSaving(true);
      await apiService.saveCompanyProfile({
        company_name: companyName,
        website_url: website,
        company_phone: phone,
        support_email: email,
      });

      await apiService.saveAssistantConfig(
        {
          assistant_name: assistantName,
          voice_engine: selectedModel,
          inbound_greeting: greeting,
          system_prompt: `You are ${assistantName}, a ${selectedTone.toLowerCase()} AI receptionist for ${companyName}.`,
          knowledge_base_notes: '',
          tone: selectedTone.toLowerCase() as any,
          business_hours: {
            monday: '09:00 - 17:00',
            tuesday: '09:00 - 17:00',
            wednesday: '09:00 - 17:00',
            thursday: '09:00 - 17:00',
            friday: '09:00 - 17:00',
          },
          escalation_rules: ['Transfer to human support for account escalation.'],
          faq_entries: [],
          capabilities: {
            company_receptionist: capabilities.includes('receptionist'),
            company_faq: capabilities.includes('faqs'),
            google_calendar: capabilities.includes('calendar'),
          },
        },
        true
      );
    } catch {
      // Continue even if local offline
    } finally {
      setSaving(false);
      onDone();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogoRow}>
          <VoxiMascot size={28} animated={false} />
          <Text style={styles.headerLogoText}>
            vocalist<Text style={{ color: '#3B5BDB' }}>.ai</Text>
          </Text>
        </View>
        <StepIndicator current={step - 1} />
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <View style={styles.stepContainer}>
            <View style={styles.centerMascotBox}>
              <VoxiMascot size={100} animated />
              <Text style={styles.sectionHeading}>Welcome to vocalist.ai</Text>
              <Text style={styles.sectionSub}>Let's set up your AI voice assistant workspace.</Text>
            </View>
            <InputField label="Full Name" placeholder="Alex Chen" value="Alex Chen" />
            <InputField label="Work Email" placeholder="alex@apexglobal.com" value="alex@apexglobal.com" />
            <InputField label="Password" placeholder="Create a password" value="••••••••••" secureTextEntry />
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepContainer}>
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.sectionHeading}>Company Profile</Text>
              <Text style={styles.sectionSub}>Your assistant will use this to represent your brand.</Text>
            </View>
            <InputField label="Company Name" placeholder="Apex Global" value={companyName} onChangeText={setCompanyName} />
            <InputField label="Website URL" placeholder="https://apexglobal.com" value={website} onChangeText={setWebsite} />
            <InputField label="Company Phone" placeholder="+1 800 555-0100" value={phone} onChangeText={setPhone} />
            <InputField label="Support Email" placeholder="support@company.com" value={email} onChangeText={setEmail} />
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepContainer}>
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.sectionHeading}>AI Assistant Setup</Text>
              <Text style={styles.sectionSub}>Configure your voice agent's personality and skills.</Text>
            </View>

            <InputField label="Assistant Name" placeholder="e.g. Aoede" value={assistantName} onChangeText={setAssistantName} />

            {/* Voice Models Carousel */}
            <View style={{ marginTop: 6 }}>
              <Text style={styles.inputLabel}>Voice Model (Gemini 2.0 Flash)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {VOICE_MODELS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setSelectedModel(m)}
                    style={[
                      styles.modelChip,
                      {
                        backgroundColor: selectedModel === m ? '#3B5BDB' : '#FFFFFF',
                        borderColor: selectedModel === m ? '#3B5BDB' : '#E8ECF4',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modelChipText,
                        { color: selectedModel === m ? '#FFFFFF' : '#475569', fontWeight: selectedModel === m ? '700' : '500' },
                      ]}
                    >
                      {m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Greeting */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Inbound Greeting</Text>
              <TextInput
                multiline
                numberOfLines={3}
                value={greeting}
                onChangeText={setGreeting}
                style={[styles.textInput, { height: 75, textAlignVertical: 'top' }]}
              />
            </View>

            {/* Tones */}
            <View>
              <Text style={styles.inputLabel}>Tone</Text>
              <View style={styles.tonesGrid}>
                {TONES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setSelectedTone(t)}
                    style={[
                      styles.toneChip,
                      {
                        backgroundColor: selectedTone === t ? '#EEF2FF' : '#FFFFFF',
                        borderColor: selectedTone === t ? '#4F46E5' : '#E8ECF4',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.toneChipText,
                        { color: selectedTone === t ? '#4F46E5' : '#64748B' },
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Capabilities */}
            <View>
              <Text style={styles.inputLabel}>Capabilities</Text>
              <View style={{ gap: 8 }}>
                {CAPABILITIES.map((cap) => {
                  const checked = capabilities.includes(cap.id);
                  return (
                    <TouchableOpacity
                      key={cap.id}
                      activeOpacity={0.7}
                      onPress={() => toggleCapability(cap.id)}
                      style={[
                        styles.capabilityCard,
                        {
                          backgroundColor: checked ? '#EEF2FF' : '#FFFFFF',
                          borderColor: checked ? 'rgba(59,91,219,0.35)' : '#E8ECF4',
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 18 }}>{cap.icon}</Text>
                      <Text style={styles.capabilityLabel}>{cap.label}</Text>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: checked ? '#3B5BDB' : 'transparent',
                            borderColor: checked ? 'transparent' : '#CBD5E1',
                          },
                        ]}
                      >
                        {checked && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Action footer */}
      <View style={styles.footer}>
        {step < 3 ? (
          <View style={styles.footerRow}>
            {step > 1 && (
              <TouchableOpacity onPress={() => setStep((s) => s - 1)} style={styles.backBtn}>
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setStep((s) => s + 1)}
              style={styles.continueBtnWrapper}
            >
              <LinearGradient
                colors={['#3B5BDB', '#4F46E5']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueBtn}
              >
                <Text style={styles.continueBtnText}>Continue →</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.backBtn}>
              <Text style={[styles.backBtnText, { color: '#3B5BDB' }]}>Save Draft</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={saving}
              onPress={handlePublish}
              style={styles.continueBtnWrapper}
            >
              <LinearGradient
                colors={['#3B5BDB', '#4F46E5']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueBtn}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.continueBtnText}>Publish Assistant</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8ECF4',
  },
  headerLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  headerLogoText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0D1526',
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stepItemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepPill: {
    height: 28,
    borderRadius: 99,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  stepNumberBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  stepLabelText: {
    fontSize: 11,
    fontWeight: '600',
  },
  stepDivider: {
    width: 12,
    height: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  stepContainer: {
    gap: 12,
  },
  centerMascotBox: {
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0D1526',
    marginTop: 6,
    marginBottom: 2,
  },
  sectionSub: {
    fontSize: 12,
    color: '#64748B',
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  textInput: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8ECF4',
    fontSize: 13,
    color: '#0D1526',
    backgroundColor: '#FAFBFF',
  },
  chipsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  modelChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1.5,
  },
  modelChipText: {
    fontSize: 12,
  },
  tonesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  toneChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1.5,
  },
  toneChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  capabilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  capabilityLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#0D1526',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8ECF4',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  backBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E8ECF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  continueBtnWrapper: {
    flex: 2,
  },
  continueBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
