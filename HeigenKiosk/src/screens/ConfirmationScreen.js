// src/screens/ConfirmationScreen.js
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';
import { colors, spacing, radii, shadow } from '../constants/theme';
import { useScale } from '../hooks/useScale';

export default function ConfirmationScreen({ customerInfo, onReset }) {
  const { s, fs, isTablet } = useScale();
  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim,   { toValue: 1, tension: 80, friction: 8, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onReset, 4000);
    return () => clearTimeout(t);
  }, []);

  const cardMaxW = isTablet ? s(500) : s(440);
  const iconSize = isTablet ? s(112) : s(120);
  const cardPadding = isTablet ? s(spacing.xxl) : s(spacing.xxxl);

  return (
    <Animated.View style={{
      flex: 1, backgroundColor: colors.background,
      alignItems: 'center', justifyContent: 'center',
      padding: s(spacing.xl), opacity: opacityAnim,
    }}>
      <Animated.View style={{
        backgroundColor: colors.card, borderRadius: s(radii.xxl),
        padding: cardPadding, alignItems: 'center',
        maxWidth: cardMaxW, width: '100%', ...shadow.lg,
        transform: [{ scale: scaleAnim }],
        borderWidth: 1,
        borderColor: colors.border,
        borderTopWidth: 4,
        borderTopColor: colors.primary,
      }}>
        <View style={{
          width: iconSize, height: iconSize, borderRadius: iconSize / 2,
          backgroundColor: colors.successBg,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: isTablet ? s(spacing.xl) : s(spacing.xxl),
          borderWidth: 2,
          borderColor: 'rgba(13, 74, 56, 0.15)',
        }}>
          <Text style={{ fontSize: s(56), color: colors.success, lineHeight: s(72), fontWeight: '700' }}>✓</Text>
        </View>

        <Text style={{ fontSize: fs(isTablet ? 21 : 24), fontWeight: '800', textAlign: 'center', marginBottom: s(spacing.lg), color: colors.foreground, letterSpacing: -0.3 }}
          allowFontScaling={false}>Booking submitted</Text>

        <Text style={{ fontSize: fs(16), textAlign: 'center', color: colors.mutedForeground, marginBottom: s(spacing.xl), lineHeight: fs(24) }}
          allowFontScaling={false}>
          Your booking is{' '}
          <Text style={{ fontWeight: '700', color: colors.primary }}>pending confirmation</Text>
          {' '}by our staff.
        </Text>

        {customerInfo?.email && (
          <Text style={{ fontSize: fs(14), textAlign: 'center', color: colors.mutedForeground, marginBottom: s(spacing.xl), lineHeight: fs(22) }}
            allowFontScaling={false}>
            Confirmation will be sent to{'\n'}
            <Text style={{ fontWeight: '700', color: colors.foreground }}>{customerInfo.email}</Text>
          </Text>
        )}

        <View style={{ width: '100%', height: 1, backgroundColor: colors.border, marginVertical: s(spacing.xl) }} />

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: s(spacing.md), marginBottom: s(spacing.xxl) }}>
          <Text style={{ fontSize: s(18), color: colors.mutedForeground, lineHeight: s(22) }}>◷</Text>
          <Text style={{ fontSize: fs(14), color: colors.mutedForeground, flex: 1, lineHeight: fs(20) }}
            allowFontScaling={false}>Please wait for a staff member to confirm your session.</Text>
        </View>

        <Text style={{ fontSize: fs(12), color: colors.mutedForeground, fontStyle: 'italic' }}
          allowFontScaling={false}>Returning to home screen...</Text>
      </Animated.View>
    </Animated.View>
  );
}
