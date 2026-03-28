// src/components/Icon.js
// ─────────────────────────────────────────────────────────────────────────────
// Zero-dependency icon component. No font loading, no native modules.
// Uses Unicode characters + Text styling to replicate Ionicons visually.
// Drop-in replacement: <Icon name="checkmark" size={20} color="#fff" />
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Text } from 'react-native';

// ── Icon map: Ionicons name → Unicode/emoji ────────────────────────────────────
// Using a mix of Unicode symbols and emoji that render identically on both
// iOS and Android without any font loading.
const ICONS = {
  // Navigation
  'arrow-back':              '←',
  'chevron-forward':         '›',
  'chevron-back':            '‹',
  'chevron-down':            '⌄',
  'close':                   '✕',

  // Status / feedback
  'checkmark':               '✓',
  'checkmark-circle':        '✓',
  'checkmark-circle-outline':'✓',
  'checkmark-done-circle-outline': '✓✓',
  'close-circle-outline':    '✕',
  'add':                     '+',
  'add-circle-outline':      '+',

  // Media / camera
  'camera-outline':          '◎',
  'cloud-offline-outline':   '✗',
  'image-outline':           '▣',

  // Time / calendar
  'time-outline':            '◷',
  'calendar-outline':        '◻',

  // People / persons
  'person-outline':          '◯',
  'people-outline':          '◎',

  // Misc UI
  'star':                    '★',
  'star-outline':            '☆',
  'reload':                  '↺',
  'refresh':                 '↺',
  'sync':                    '↻',
  'sparkles-outline':        '✦',
  'information-circle':      'ℹ',
  'alert-circle':            '⚠',
  'create-outline':          '✎',
  'trash-outline':           '⌫',
  'menu':                    '≡',
  'ellipsis-horizontal':     '···',

  // Status-specific (used in AdminBookingQueue STATUS_CONFIG)
  'time-outline':            '◷',
  'camera-outline':          '◎',
  'checkmark-circle-outline':'✓',
};

export default function Icon({ name = '', size = 20, color = '#000', style }) {
  const char = ICONS[name] ?? '•';

  // Special handling for circle-wrapped icons to match the Ionicons visual weight
  const isCircleIcon = name.includes('circle') || name === 'reload' || name === 'sync';

  return (
    <Text
      style={[
        {
          fontSize: isCircleIcon ? size * 1.1 : size,
          color,
          // Prevent text scaling from system accessibility settings
          // breaking layout in a kiosk context
          includeFontPadding: false,
          textAlignVertical: 'center',
          lineHeight: size * 1.35,
        },
        style,
      ]}
      allowFontScaling={false}
    >
      {char}
    </Text>
  );
}
