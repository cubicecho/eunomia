import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// The few pieces every screen shares. Deliberately small: this app is a status
// panel with a couple of forms, and the phone's job is the same as the desktop
// tray's — say what the agent is doing and let you change it.

interface ScreenProps {
  title: string;
  subtitle?: string;
  /** Shown when there is somewhere to go back to (any screen but the status one). */
  onBack?: () => void;
  children: ReactNode;
}

export function Screen({ title, subtitle, onBack, children }: ScreenProps) {
  return (
    <ScrollView contentContainerStyle={ui.screen} keyboardShouldPersistTaps="handled">
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={ui.back}>
          <Text style={ui.backText}>‹ Back</Text>
        </Pressable>
      ) : null}
      <Text style={ui.title}>{title}</Text>
      {subtitle ? <Text style={ui.sub}>{subtitle}</Text> : null}
      {children}
    </ScrollView>
  );
}

/** A label/value line, matching the desktop tray's disabled status entries. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={ui.row}>
      <Text style={ui.rowLabel}>{label}</Text>
      {typeof children === 'string' ? <Text style={ui.rowValue}>{children}</Text> : children}
    </View>
  );
}

/**
 * A tray-menu-style entry: the phone equivalent of "Open Dashboard…" and the
 * rest of the desktop agent's menu items.
 */
export function MenuItem({
  label,
  detail,
  onPress,
  disabled,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [ui.menuItem, pressed && ui.menuItemPressed, disabled && ui.dim]}
    >
      <Text style={ui.menuLabel}>{label}</Text>
      {detail ? <Text style={ui.menuDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  screen: { padding: 28, paddingBottom: 48 },
  back: { marginBottom: 10 },
  backText: { color: '#4f6ef7', fontSize: 16 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 4 },
  sub: { opacity: 0.7, marginBottom: 20 },
  label: { fontWeight: '600', marginTop: 14, marginBottom: 4 },
  hint: { opacity: 0.7, fontSize: 13, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top', fontFamily: 'monospace' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  rowLabel: { fontWeight: '600' },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  menuItem: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  menuItemPressed: { backgroundColor: '#eef1fd' },
  menuLabel: { fontSize: 16, color: '#4f6ef7' },
  menuDetail: { opacity: 0.7, fontSize: 13, marginTop: 2 },
  dim: { opacity: 0.4 },
  button: { marginTop: 22 },
  error: { color: '#d33', marginTop: 12 },
  warn: { color: '#b3261e', flexShrink: 1, textAlign: 'right' },
  section: {
    marginTop: 26,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    fontSize: 12,
  },
});
