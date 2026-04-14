import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  isPostgresPoolerAvailable,
  runPoolerQuery,
} from "../native/postgresPooler";
import { colors, spacing, radii } from "../constants/theme";

const DEFAULT_SQL =
  "SELECT current_database() AS db, current_user AS role_name, version() AS pg_version;";

export default function PoolerPocScreen() {
  const envUrl = process.env.EXPO_PUBLIC_PG_JDBC_URL || "";
  const envUser = process.env.EXPO_PUBLIC_PG_USER || "";
  const envPass = process.env.EXPO_PUBLIC_PG_PASSWORD || "";

  const [jdbcUrl, setJdbcUrl] = useState(envUrl);
  const [user, setUser] = useState(envUser);
  const [password, setPassword] = useState(envPass);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const available = useMemo(() => isPostgresPoolerAvailable(), []);

  async function onRun() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const out = await runPoolerQuery(jdbcUrl, user, password, sql);
      if (out.kind === "update") {
        setResult({
          columns: [],
          rows: [{ updateCount: out.updateCount }],
          rowCount: 1,
          truncated: false,
        });
        return;
      }
      const columns = out.columns ? Array.from(out.columns) : [];
      const rows = out.rows ? Array.from(out.rows) : [];
      setResult({
        columns,
        rows,
        rowCount: out.rowCount,
        truncated: out.truncated,
      });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: colors.error,
            marginBottom: spacing.sm,
          }}
        >
          POC only — DB credentials in an APK are extractable. Use PostgREST + anon + RLS for real
          kiosks.
        </Text>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: spacing.md }}>
          Android JDBC → Supabase transaction pooler (port 6543) or session pooler. Paste the JDBC URL
          from the Supabase dashboard (Database → connection string → URI, then prefix with{" "}
          jdbc:postgresql://…).
        </Text>
        {!available && (
          <Text style={{ color: colors.error, marginBottom: spacing.md }}>
            Native module is only built into the Android app (not iOS/web). Platform: {Platform.OS}
          </Text>
        )}

        <Text style={{ fontWeight: "600", marginTop: spacing.sm }}>JDBC URL</Text>
        <TextInput
          value={jdbcUrl}
          onChangeText={setJdbcUrl}
          placeholder="jdbc:postgresql://aws-0-....pooler.supabase.com:6543/postgres?sslmode=require"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={inputStyle}
        />

        <Text style={{ fontWeight: "600", marginTop: spacing.sm }}>User</Text>
        <TextInput
          value={user}
          onChangeText={setUser}
          autoCapitalize="none"
          style={inputStyle}
        />

        <Text style={{ fontWeight: "600", marginTop: spacing.sm }}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          style={inputStyle}
        />

        <Text style={{ fontWeight: "600", marginTop: spacing.sm }}>SQL (read-only recommended)</Text>
        <TextInput
          value={sql}
          onChangeText={setSql}
          multiline
          style={[inputStyle, { minHeight: 100 }]}
        />

        <TouchableOpacity
          onPress={onRun}
          disabled={loading || !available}
          style={{
            marginTop: spacing.lg,
            backgroundColor: available ? colors.primary : colors.muted,
            padding: spacing.md,
            borderRadius: radii.md,
            alignItems: "center",
          }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "700" }}>Run query</Text>
          )}
        </TouchableOpacity>

        {error ? (
          <Text style={{ marginTop: spacing.lg, color: colors.error }}>{error}</Text>
        ) : null}

        {result ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={{ fontWeight: "700", marginBottom: spacing.sm }}>
              Rows: {result.rowCount}
              {result.truncated ? " (truncated at 200)" : ""}
            </Text>
            <Text selectable style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 }}>
              {JSON.stringify(result.rows, null, 2)}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radii.md,
  padding: spacing.sm,
  marginTop: 6,
  color: colors.foreground,
  backgroundColor: colors.card,
};
