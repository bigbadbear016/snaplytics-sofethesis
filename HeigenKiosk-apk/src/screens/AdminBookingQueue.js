// src/screens/AdminBookingQueue.js
import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, Pressable, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Icon from '../components/Icon';
import { useApi, useMutation } from '../hooks/useApi';
import { fetchBookingsByStatus, updateBookingStatus, fetchPopularRecommendations } from '../api/client';
import { Button, Divider, LoadingScreen, ErrorScreen } from '../components/ui';
import { BOOKING_STATUS } from '../constants/api';
import { colors, spacing, radii, typography, shadow } from '../constants/theme';

const STATUS_CONFIG = {
  [BOOKING_STATUS.PENDING]: {
    label: 'Pending', color: '#f59e0b', bg: '#fef3c7', icon: 'time-outline',
  },
  [BOOKING_STATUS.ONGOING]: {
    label: 'Ongoing', color: '#3b82f6', bg: '#eff6ff', icon: 'camera-outline',
  },
  [BOOKING_STATUS.DONE]: {
    label: 'Done', color: colors.success, bg: '#ecfdf5', icon: 'checkmark-circle-outline',
  },
};

export default function AdminBookingQueue() {
  const router = useRouter();
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [refreshing, setRefreshing]           = useState(false);
  const [recommenderMsg, setRecommenderMsg]   = useState(null);
  const [refreshingRec, setRefreshingRec]     = useState(false);

  const fetchActive = useCallback(() => fetchBookingsByStatus('Pending,Ongoing'), []);
  const { data: bookings, loading, error, refetch } = useApi(fetchActive);
  const { mutate: updateStatus, loading: updating }  = useMutation(
    (id, status) => updateBookingStatus(id, status),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  async function handleStatusChange(booking, newStatus) {
    const labels = {
      [BOOKING_STATUS.ONGOING]:   'Accept this booking?',
      [BOOKING_STATUS.DONE]:      'Mark session as done?',
      [BOOKING_STATUS.CANCELLED]: 'Cancel this booking?',
    };
    Alert.alert('Confirm', labels[newStatus] || 'Update status?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        style: newStatus === BOOKING_STATUS.CANCELLED ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await updateStatus(booking.id, newStatus);
            setSelectedBooking(null);
            refetch();
          } catch (err) {
            Alert.alert('Error', err.message || 'Failed to update status.');
          }
        },
      },
    ]);
  }

  async function handleRefreshRecommender() {
    setRefreshingRec(true);
    setRecommenderMsg(null);
    try {
      const res = await fetchPopularRecommendations(3);
      setRecommenderMsg({
        type: res?.recommendations?.length ? 'success' : 'warn',
        text: res?.recommendations?.length
          ? 'Recommender refreshed from live booking data.'
          : 'Recommender updates automatically as bookings are added.',
      });
    } catch {
      setRecommenderMsg({
        type: 'warn',
        text: 'Recommender uses live booking counts — it updates automatically.',
      });
    } finally {
      setRefreshingRec(false);
      setTimeout(() => setRecommenderMsg(null), 5000);
    }
  }

  if (loading && !refreshing) return <LoadingScreen message="Loading booking queue..." />;
  if (error)                  return <ErrorScreen message={error} onRetry={refetch} />;

  const pending = (bookings || []).filter((b) => b.session_status === BOOKING_STATUS.PENDING);
  const ongoing = (bookings || []).filter((b) => b.session_status === BOOKING_STATUS.ONGOING);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Booking Queue</Text>
          <Text style={styles.headerSub}>{pending.length} pending · {ongoing.length} ongoing</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => router.push('/pooler-poc')} style={styles.poolerBtn}>
            <Text style={styles.poolerBtnText}>JDBC POC</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefreshRecommender} disabled={refreshingRec} style={styles.recBtn}>
            <Icon name={refreshingRec ? 'sync' : 'sparkles-outline'} size={16} color={colors.accent} />
            <Text style={styles.recBtnText}>Refresh AI</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={styles.reloadBtn}>
            <Icon name="reload" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Recommender toast */}
      {recommenderMsg && (
        <View style={[styles.recMsg, recommenderMsg.type === 'success' ? styles.recMsgSuccess : styles.recMsgWarn]}>
          <Icon
            name={recommenderMsg.type === 'success' ? 'checkmark-circle' : 'information-circle'}
            size={14}
            color={recommenderMsg.type === 'success' ? colors.success : colors.accent}
          />
          <Text style={styles.recMsgText}>{recommenderMsg.text}</Text>
        </View>
      )}

      <FlatList
        data={[...pending, ...ongoing]}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <BookingCard booking={item} onPress={() => setSelectedBooking(item)} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>◻</Text>
            <Text style={styles.emptyTitle}>No Active Bookings</Text>
            <Text style={styles.emptyText}>Pull down to refresh</Text>
          </View>
        }
      />

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onStatusChange={handleStatusChange}
          updating={updating}
        />
      )}
    </SafeAreaView>
  );
}

function BookingCard({ booking, onPress }) {
  const cfg = STATUS_CONFIG[booking.session_status] || STATUS_CONFIG[BOOKING_STATUS.PENDING];
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      <View style={[styles.statusStrip, { backgroundColor: cfg.color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.customerName}>{booking.customer_name || 'Unknown Customer'}</Text>
            <Text style={styles.packageName}>{booking.packageName || '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing.sm }}>
            <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
              <Icon name={cfg.icon} size={11} color={cfg.color} />
              <Text style={[styles.statusPillText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
            <Text style={styles.cardPrice}>₱{Number(booking.total || 0).toLocaleString()}</Text>
          </View>
        </View>
        <Divider style={{ marginVertical: spacing.sm }} />
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>◻ {booking.date || 'No date'}</Text>
          {booking.addons?.length > 0 && (
            <Text style={styles.metaText}>+ {booking.addons.length} add-on(s)</Text>
          )}
          <Text style={[styles.metaText, { color: colors.accent }]}>Tap to manage →</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function BookingDetailModal({ booking, onClose, onStatusChange, updating }) {
  const cfg     = STATUS_CONFIG[booking.session_status] || STATUS_CONFIG[BOOKING_STATUS.PENDING];
  const isPend  = booking.session_status === BOOKING_STATUS.PENDING;
  const isGoing = booking.session_status === BOOKING_STATUS.ONGOING;
  const addons  = Array.isArray(booking.addons) ? booking.addons : [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.detailSheet}>
        <View style={styles.handle} />
        <View style={[styles.detailHeader, { backgroundColor: cfg.bg }]}>
          <View style={styles.detailHeaderLeft}>
            <Icon name={cfg.icon} size={26} color={cfg.color} />
            <View>
              <Text style={[styles.detailStatus, { color: cfg.color }]}>{cfg.label}</Text>
              <Text style={styles.detailId}>Booking #{booking.id}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.detailBody}>
          <Section title="Customer">
            <DetailRow icon="person-outline"   label={booking.customer_name || '—'} />
            <DetailRow icon="calendar-outline" label={booking.date || 'No preferred date'} />
          </Section>

          <Section title="Package">
            <View style={styles.pkgBox}>
              <Text style={styles.pkgBoxName}>{booking.packageName}</Text>
              <Text style={styles.pkgBoxPrice}>₱{Number(booking.packagePrice || 0).toLocaleString()}</Text>
            </View>
          </Section>

          {addons.length > 0 && (
            <Section title="Add-ons">
              {addons.map((a, i) => (
                <View key={i} style={styles.addonRow}>
                  <Text style={styles.addonName}>{a.name}</Text>
                  <Text style={styles.addonPrice}>₱{Number(a.price).toLocaleString()} × {a.quantity}</Text>
                </View>
              ))}
            </Section>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalPrice}>₱{Number(booking.total || 0).toLocaleString()}</Text>
          </View>

          <Divider style={{ marginVertical: spacing.xl }} />

          <View style={styles.actionGroup}>
            {isPend && (
              <Button label="Accept → Ongoing" icon="checkmark-circle"
                onPress={() => onStatusChange(booking, BOOKING_STATUS.ONGOING)}
                loading={updating} fullWidth style={{ marginBottom: spacing.lg }} />
            )}
            {isGoing && (
              <Button label="Mark Session as Done" icon="checkmark-circle"
                onPress={() => onStatusChange(booking, BOOKING_STATUS.DONE)}
                loading={updating} fullWidth
                style={{ marginBottom: spacing.lg, backgroundColor: colors.success }} />
            )}
            <Button label="Cancel Booking" variant="danger" icon="close-circle-outline"
              onPress={() => onStatusChange(booking, BOOKING_STATUS.CANCELLED)}
              loading={updating} fullWidth />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ icon, label }) {
  return (
    <View style={styles.detailRow}>
      <Icon name={icon} size={15} color={colors.mutedForeground} />
      <Text style={styles.detailRowText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border, ...shadow.sm,
  },
  headerTitle:   { ...typography.h3 },
  headerSub:     { ...typography.xs, color: colors.mutedForeground, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accentLight, borderWidth: 1,
    borderColor: colors.borderStrong, borderRadius: radii.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  recBtnText: { ...typography.xs, color: colors.primary, fontWeight: '700' },
  poolerBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBg,
  },
  poolerBtnText: { ...typography.xs, color: colors.error, fontWeight: '700' },
  reloadBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center',
  },

  recMsg: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginHorizontal: spacing.xl, marginTop: spacing.md,
    padding: spacing.lg, borderRadius: radii.lg,
  },
  recMsgSuccess: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#6ee7b7' },
  recMsgWarn:    { backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.borderStrong },
  recMsgText:    { ...typography.xs, flex: 1, color: colors.foreground, lineHeight: 18 },

  list: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: radii.xl, overflow: 'hidden', ...shadow.md },
  statusStrip: { width: 5 },
  cardBody:    { flex: 1, padding: spacing.xl },
  cardTop:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  customerName:{ ...typography.bodyB, marginBottom: 2 },
  packageName: { ...typography.sm, color: colors.mutedForeground },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.full,
  },
  statusPillText: { ...typography.xs, fontWeight: '700' },
  cardPrice:      { ...typography.smB, color: colors.accent },
  cardMeta:       { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' },
  metaText:       { ...typography.xs, color: colors.mutedForeground },

  empty:      { alignItems: 'center', padding: spacing.xxxl * 2 },
  emptyIcon:  { fontSize: 56, color: colors.mutedForeground },
  emptyTitle: { ...typography.h3, color: colors.mutedForeground, marginTop: spacing.xl },
  emptyText:  { ...typography.sm, color: colors.mutedForeground, marginTop: spacing.sm },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  detailSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl, maxHeight: '88%', ...shadow.lg,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginTop: spacing.md,
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.xl,
  },
  detailHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  detailStatus:     { ...typography.h4 },
  detailId:         { ...typography.xs, color: colors.mutedForeground },
  detailBody:       { padding: spacing.xxl, paddingBottom: spacing.xxxl },

  section:       { marginBottom: spacing.xl },
  sectionTitle:  { ...typography.smB, color: colors.mutedForeground, marginBottom: spacing.md },
  detailRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  detailRowText: { ...typography.body },

  pkgBox:      { backgroundColor: colors.muted, borderRadius: radii.lg, padding: spacing.lg },
  pkgBoxName:  { ...typography.bodyB },
  pkgBoxPrice: { ...typography.smB, color: colors.accent, marginTop: 4 },

  addonRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  addonName:  { ...typography.sm, flex: 1 },
  addonPrice: { ...typography.smB, color: colors.accent },

  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...typography.h4 },
  totalPrice: { fontSize: 28, fontWeight: '700', color: colors.accent },
  actionGroup:{},
});
