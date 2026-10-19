import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const isWeb = Platform.OS === "web";

const fontMono = Platform.select({
  ios: "Menlo",
  default: "monospace",
});

export const Colors = {
  background: "#eef3f9",
  surface: "#ffffff",
  card: "#f6f9fc",
  border: "#dbe5ef",
  text: "#0f172a",
  muted: "#475569",
  primary: "#0f766e",
  success: "#15803d",
  danger: "#b91c1c",
  disk: "#1d4ed8",
  accent: "#334155",
};

type ButtonVariant = "primary" | "secondary";

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  style?: ViewStyle;
  disabled?: boolean;
  testID?: string;
};

const buttonBackground: Record<ButtonVariant, string> = {
  primary: Colors.primary,
  secondary: Colors.card,
};

const buttonTextColor: Record<ButtonVariant, string> = {
  primary: "#f8fafc",
  secondary: Colors.text,
};

export const Button = ({
  title,
  onPress,
  variant = "primary",
  style,
  disabled = false,
  testID,
}: ButtonProps) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={title}
    accessibilityState={{ disabled }}
    hitSlop={6}
    style={({ pressed }) => [
      styles.button,
      { backgroundColor: buttonBackground[variant] },
      pressed && !disabled && styles.buttonPressed,
      disabled && styles.buttonDisabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Text style={[styles.buttonText, { color: buttonTextColor[variant] }]}>
      {title}
    </Text>
  </Pressable>
);

type CardProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  indicatorColor?: string;
};

export const Card = ({
  children,
  title,
  subtitle,
  indicatorColor = Colors.primary,
}: CardProps) => (
  <View style={styles.card}>
    {title ? (
      <View style={styles.cardHeader}>
        <View
          style={[styles.indicator, { backgroundColor: `${indicatorColor}33` }]}
        >
          <View
            style={[styles.indicatorDot, { backgroundColor: indicatorColor }]}
          />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
    ) : null}
    <View style={styles.cardContent}>{children}</View>
  </View>
);

type InputProps = Omit<TextInputProps, "value" | "onChangeText" | "style"> & {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
};

export const Input = ({ label, value, onChangeText, ...props }: InputProps) => (
  <View style={styles.inputGroup}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <TextInput
      style={styles.textInput}
      value={value}
      onChangeText={onChangeText}
      placeholderTextColor={Colors.muted}
      selectionColor={Colors.primary}
      {...props}
    />
  </View>
);

export const StatusRow = ({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) => (
  <View style={styles.statusRow}>
    <Text style={styles.statusLabel}>{label}</Text>
    <Text testID={testID} style={styles.statusValue}>
      {value}
    </Text>
  </View>
);

export const ResultsProbe = ({
  testID,
  label,
}: {
  testID: string;
  label: string;
}) => (
  <View
    testID={testID}
    accessible
    accessibilityLabel={label}
    style={styles.resultsProbe}
  />
);

export const CodeBlock = ({
  children,
  testID,
}: {
  children: string;
  testID?: string;
}) => (
  <ScrollView
    contentContainerStyle={styles.codeBlockContent}
    horizontal
    showsHorizontalScrollIndicator
    style={styles.codeBlock}
  >
    <Text testID={testID} style={styles.codeBlockText}>
      {children}
    </Text>
  </ScrollView>
);

export const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

type PageProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
};

function Header({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;

  return (
    <View style={styles.header}>
      {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export const Page = ({ children, title, subtitle }: PageProps) => {
  const insets = useSafeAreaInsets();
  const contentPaddingTop = insets.top + (isWeb ? 18 : 10);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: contentPaddingTop },
        ]}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        style={styles.pageBody}
      >
        <Header title={title} subtitle={subtitle} />
        {children}
      </ScrollView>
    </View>
  );
};

const consumerStyles = {
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  flex1: {
    flex: 1,
  },
} as const;

export const styles = StyleSheet.create({
  ...consumerStyles,
  resultsProbe: {
    height: 1,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  pageBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 108,
    gap: 14,
    maxWidth: isWeb ? 860 : "100%",
    alignSelf: "center",
    width: "100%",
  },
  header: {
    marginBottom: 6,
    gap: 5,
  },
  headerTitle: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: 0,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: Colors.muted,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.09)",
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  indicator: {
    width: 18,
    height: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitleWrap: {
    flexShrink: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: 0,
  },
  cardSubtitle: {
    fontSize: 11,
    color: Colors.muted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardContent: {
    gap: 12,
  },
  button: {
    minHeight: 42,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  textInput: {
    minHeight: 42,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.muted,
  },
  statusValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 13,
    color: Colors.text,
    fontFamily: fontMono,
    fontWeight: "700",
  },
  codeBlock: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  codeBlockContent: {
    padding: 14,
    minWidth: "100%",
  },
  codeBlockText: {
    fontFamily: fontMono,
    fontSize: 12,
    lineHeight: 18,
    color: "#cbd5e1",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 4,
  },
});
