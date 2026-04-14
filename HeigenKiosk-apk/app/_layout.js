import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { flex: 1 },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="admin"
        options={{
          headerShown: true,
          title: "Admin queue",
        }}
      />
      <Stack.Screen
        name="pooler-poc"
        options={{
          headerShown: true,
          title: "Postgres pooler POC",
        }}
      />
    </Stack>
  );
}
