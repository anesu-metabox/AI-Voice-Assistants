import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiService, ThreeCXPayload, ThreeCXStatus } from '../services/api';
import { useTheme } from '../context/ThemeContext';

// ─── Component 1: GoogleCalendarIntegrationCard (1:1 from frontend) ───────────

function GoogleCalendarIntegrationCard() {
  const { colors } = useTheme();
  const [connected, setConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const data = await apiService.getGoogleAuthStatus();
      if (data.connected) {
        setConnected(true);
        setConnectedEmail(data.google_email || data.email || null);
      } else {
        setConnected(false);
        setConnectedEmail(null);
      }
    } catch {
      setConnected(false);
      setConnectedEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const authUrl = await apiService.getGoogleAuthUrl();
      if (typeof window !== 'undefined' && (window as any).open) {
        (window as any).open(authUrl, '_blank');
      } else {
        await Linking.openURL(authUrl);
      }
    } catch {
      // Fallback
    }

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const current = await apiService.getGoogleAuthStatus();
      if (current.connected) {
        clearInterval(interval);
        setConnected(true);
        setConnectedEmail(current.google_email || current.email || 'ops@apexglobal.com');
        setBusy(false);
      } else if (attempts > 12) {
        clearInterval(interval);
        setBusy(false);
      }
    }, 1500);
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await apiService.disconnectGoogleAuth();
      setConnected(false);
      setConnectedEmail(null);
    } catch {
      setConnected(false);
      setConnectedEmail(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <View style={styles.cardHeaderRow}>
        <View style={[styles.iconBox, { backgroundColor: 'rgba(59,91,219,0.12)', borderColor: 'rgba(59,91,219,0.3)' }]}>
          <Text style={{ fontSize: 22 }}>📅</Text>
        </View>
        <View style={styles.statusIndicatorRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: loading ? '#9CA3AF' : connected ? '#22C55E' : '#9CA3AF' },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: loading ? colors.textMuted : connected ? '#22C55E' : colors.textMuted },
            ]}
          >
            {loading ? 'Checking...' : connected ? 'Connected' : 'Not Connected'}
          </Text>
        </View>
      </View>

      <Text style={[styles.cardTitle, { color: colors.textHeading }]}>Google Calendar Sync</Text>
      <Text style={[styles.cardDesc, { color: colors.textMuted }]}>
        Connect this company's Google account so the assistant can check availability, list events, book meetings, and cancel them with confirmation.
      </Text>

      <View style={[styles.accountTable, { borderTopColor: colors.border }]}>
        <View style={styles.tableRow}>
          <Text style={[styles.tableLabel, { color: colors.textHeading }]}>Connected account</Text>
          <Text style={[styles.tableValue, { color: colors.textMuted }]}>
            {connectedEmail || 'No Google account connected'}
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableLabel, { color: colors.textHeading }]}>Calendar</Text>
          <Text style={[styles.tableValue, { color: colors.textMuted }]}>Primary Google Calendar</Text>
        </View>
      </View>

      {connected ? (
        <TouchableOpacity
          onPress={handleDisconnect}
          disabled={busy}
          style={[styles.btnDisconnectGoogle, { opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <Text style={styles.btnDisconnectGoogleText}>Disconnect Google Calendar</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={handleConnect}
          disabled={busy}
          style={[styles.btnConnectGoogle, { opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.btnConnectGoogleText}>Connect Google Calendar</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Component 2: ThreeCXIntegrationCard (1:1 from frontend) ──────────────────

function ThreeCXIntegrationCard() {
  const { colors } = useTheme();
  const [connectionName, setConnectionName] = useState('');
  const [pbxUrl, setPbxUrl] = useState('');
  const [appId, setAppId] = useState('');
  const [routePointDn, setRoutePointDn] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [dids, setDids] = useState('');
  const [transferDestinations, setTransferDestinations] = useState('');
  const [failureAction, setFailureAction] = useState<'' | 'disconnect' | 'transfer'>('');
  const [failureDestination, setFailureDestination] = useState('');
  const [status, setStatus] = useState<ThreeCXStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiService.getThreeCXStatus();
      setStatus(data);
      if (data.connectionName) setConnectionName(data.connectionName);
      if (data.pbxHost) setPbxUrl(data.pbxHost.startsWith('http') ? data.pbxHost : `https://${data.pbxHost}`);
      if (data.appId) setAppId(data.appId);
      if (data.routePointDn) setRoutePointDn(data.routePointDn);
      if (Array.isArray(data.dids)) setDids(data.dids.join(', '));
      if (Array.isArray(data.transferDestinations)) setTransferDestinations(data.transferDestinations.join(', '));
      if (data.failureAction === 'disconnect' || data.failureAction === 'transfer') {
        setFailureAction(data.failureAction);
      }
      if (data.failureDestination) setFailureDestination(data.failureDestination);
      setClientSecret('');
    } catch {
      setStatus({ configured: false, error: 'Could not load the 3CX connection details' });
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSave = async () => {
    if (!appId || !pbxUrl || !routePointDn || !clientSecret || !failureAction) {
      Alert.alert('Missing Fields', 'Please complete all required 3CX fields including client secret and fallback action.');
      return;
    }
    setBusy(true);
    try {
      const payload: ThreeCXPayload = {
        connection_name: connectionName,
        pbx_url: pbxUrl,
        app_id: appId,
        route_point_dn: routePointDn,
        client_secret: clientSecret,
        dids: dids.split(',').map((v) => v.trim()).filter(Boolean),
        transfer_destinations: transferDestinations.split(',').map((v) => v.trim()).filter(Boolean),
        failure_action: failureAction,
        failure_destination: failureAction === 'transfer' ? failureDestination : null,
      };

      const result = await apiService.saveThreeCXConfig(payload);
      if (!result.success) {
        throw new Error(result.message || '3CX connection test and save failed');
      }
      setClientSecret('');
      setStatus({ configured: true, state: 'active' });
      Alert.alert('Success', '3CX PBX connection saved successfully.');
      await loadStatus();
    } catch (err: any) {
      setStatus((current) => ({ ...(current || {}), error: err?.message || '3CX connection failed' }));
    } finally {
      setClientSecret('');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    Alert.alert(
      'Disconnect 3CX',
      "Disconnect this company's 3CX integration and remove its stored API key?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await apiService.disconnectThreeCX();
              setStatus({ configured: false, state: 'unconfigured' });
              setConnectionName('');
              setPbxUrl('');
              setAppId('');
              setRoutePointDn('');
              setDids('');
              setTransferDestinations('');
              setFailureAction('');
              setFailureDestination('');
              setClientSecret('');
            } catch (err: any) {
              setStatus((current) => ({ ...(current || {}), error: err?.message || '3CX could not be disconnected' }));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const destinationsList = transferDestinations
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return (
    <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <View style={styles.cardHeaderRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 18 }}>📞</Text>
            <Text style={[styles.cardTitle, { color: colors.textHeading }]}>3CX PBX</Text>
          </View>
          <Text style={[styles.cardDesc, { color: colors.textMuted, marginTop: 4 }]}>
            Store and validate this company's own 3CX connection. Live call routing is still being implemented.
          </Text>
        </View>
        <View style={styles.pbxStatusTag}>
          <Text
            style={[
              styles.pbxStatusText,
              { color: status?.state === 'active' ? '#22C55E' : colors.textMuted },
            ]}
          >
            {status?.state === 'active' ? '● Active' : status?.state || 'Not configured'}
          </Text>
        </View>
      </View>

      {/* Form Fields (Clean Single-Column Mobile Flow) */}
      <View style={styles.formGroupList}>
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Connection name</Text>
          <TextInput
            value={connectionName}
            onChangeText={setConnectionName}
            placeholder="e.g. Apex 3CX Production"
            placeholderTextColor={colors.textMuted}
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>PBX HTTPS URL</Text>
          <TextInput
            value={pbxUrl}
            onChangeText={setPbxUrl}
            placeholder="https://pbx.example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>3CX Service Principal client ID</Text>
          <TextInput
            value={appId}
            onChangeText={setAppId}
            placeholder="Client ID from 3CX Console"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Programmable Extension / Route Point DN</Text>
          <TextInput
            value={routePointDn}
            onChangeText={setRoutePointDn}
            placeholder="e.g. 100"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>3CX client secret (write-only)</Text>
          <TextInput
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="••••••••••••••••"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Inbound DIDs (comma-separated)</Text>
          <TextInput
            value={dids}
            onChangeText={setDids}
            placeholder="+18005550100, +18005550101"
            placeholderTextColor={colors.textMuted}
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Transfer destinations (comma-separated)</Text>
          <TextInput
            value={transferDestinations}
            onChangeText={setTransferDestinations}
            placeholder="101, 102, 103"
            placeholderTextColor={colors.textMuted}
            style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
          />
        </View>

        {/* Fallback Selection */}
        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
            If the assistant cannot handle a live call
          </Text>
          <View style={styles.pillRow}>
            <TouchableOpacity
              onPress={() => {
                setFailureAction('disconnect');
                setFailureDestination('');
              }}
              style={[
                styles.optionPill,
                {
                  backgroundColor: failureAction === 'disconnect' ? '#3B5BDB' : colors.bg,
                  borderColor: failureAction === 'disconnect' ? '#3B5BDB' : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionPillText,
                  { color: failureAction === 'disconnect' ? '#FFFFFF' : colors.textMuted },
                ]}
              >
                Disconnect the caller
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFailureAction('transfer')}
              style={[
                styles.optionPill,
                {
                  backgroundColor: failureAction === 'transfer' ? '#3B5BDB' : colors.bg,
                  borderColor: failureAction === 'transfer' ? '#3B5BDB' : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.optionPillText,
                  { color: failureAction === 'transfer' ? '#FFFFFF' : colors.textMuted },
                ]}
              >
                Transfer to destination
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* If Transfer: Approved Fallback Destination Picker */}
        {failureAction === 'transfer' && (
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.textMuted }]}>
              Approved fallback destination
            </Text>
            {destinationsList.length > 0 ? (
              <View style={styles.pillRow}>
                {destinationsList.map((dest) => {
                  const isSelected = failureDestination === dest;
                  return (
                    <TouchableOpacity
                      key={dest}
                      onPress={() => setFailureDestination(dest)}
                      style={[
                        styles.optionPill,
                        {
                          backgroundColor: isSelected ? '#3B5BDB' : colors.bg,
                          borderColor: isSelected ? '#3B5BDB' : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionPillText,
                          { color: isSelected ? '#FFFFFF' : colors.textHeading },
                        ]}
                      >
                        {dest}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <TextInput
                value={failureDestination}
                onChangeText={setFailureDestination}
                placeholder="Enter destination extension (e.g. 101)"
                placeholderTextColor={colors.textMuted}
                style={[styles.inputField, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.textHeading }]}
              />
            )}
            <Text style={[styles.helperNote, { color: colors.textMuted }]}>
              The fallback must also appear in the approved transfer destinations above.
            </Text>
          </View>
        )}
      </View>

      {/* Error Banner */}
      {status?.error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorBoxText}>{status.error}</Text>
        </View>
      )}

      {/* Security Note (1:1 from frontend) */}
      <Text style={[styles.helperNote, { color: colors.textMuted }]}>
        Re-authenticate before changes. The client ID and Route Point DN are separate; the client secret is write-only and cleared after submission.
      </Text>

      {/* Action Buttons */}
      <View style={styles.buttonRow}>
        {status?.configured && (
          <TouchableOpacity
            onPress={handleDisconnect}
            disabled={busy}
            style={[styles.btnDisconnect3CX, { opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={styles.btnDisconnect3CXText}>
              {busy ? 'Working…' : 'Disconnect'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={handleSave}
          disabled={busy}
          style={[styles.btnSave3CX, { opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.btnSave3CXText}>Test & save 3CX</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Component 3: Data Isolation & Security Protocols Card (1:1 from frontend) ─

function SecurityNoticeCard() {
  const { colors } = useTheme();
  return (
    <View style={[styles.securityCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
      <View style={styles.securityIconBox}>
        <Text style={{ fontSize: 20 }}>🛡️</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.securityTitle, { color: colors.textHeading }]}>
          Data Isolation & Security Protocols
        </Text>
        <Text style={[styles.securityDesc, { color: colors.textMuted }]}>
          Google credentials are encrypted before persistence and are never returned to the browser. Calendar operations use the authenticated company's connected account. Production KMS and workload-role provisioning remain release gates; no HIPAA or SOC 2 certification is claimed here.
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen: IntegrationsScreen ──────────────────────────────────────────

export default function IntegrationsScreen() {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {/* Header (1:1 from frontend) */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textHeading }]}>
          Integrations & Workspace Apps
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Connect this company's Google Calendar and configure its optional 3CX integration.
        </Text>
      </View>

      <View style={styles.body}>
        {/* 1. Google Calendar Integration Card */}
        <GoogleCalendarIntegrationCard />

        {/* 2. 3CX PBX Card */}
        <ThreeCXIntegrationCard />

        {/* 3. Security Notice Card */}
        <SecurityNoticeCard />
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  body: {
    padding: 16,
    gap: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  cardDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  accountTable: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 8,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  tableValue: {
    fontSize: 12,
  },
  btnConnectGoogle: {
    backgroundColor: '#3B5BDB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  btnConnectGoogleText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisconnectGoogle: {
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisconnectGoogleText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
  pbxStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  pbxStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  formGroupList: {
    gap: 10,
  },
  inputGroup: {
    gap: 5,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  optionPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  helperNote: {
    fontSize: 11,
    lineHeight: 15,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 10,
  },
  errorBoxText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 6,
  },
  btnDisconnect3CX: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisconnect3CXText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
  },
  btnSave3CX: {
    backgroundColor: '#3B5BDB',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B5BDB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  btnSave3CXText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  securityCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  securityIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  securityTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  securityDesc: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
