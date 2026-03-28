// src/components/ui.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared primitive UI components — fully responsive via useScale().
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    ScrollView,
    Modal,
    Pressable,
    TextInput,
} from "react-native";
import Icon from "./Icon";
import { colors, spacing, radii, typography, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({
    onPress,
    label,
    variant = "primary",
    disabled = false,
    size = "md",
    loading = false,
    icon,
    style,
    labelStyle,
    fullWidth = false,
}) {
    const { s, fs } = useScale();
    const isDisabled = disabled || loading;
    const paddingV = size === "sm" ? s(1) : s(spacing.lg);

    const containerStyles = [
        {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: s(spacing.xxl),
            paddingVertical: paddingV,
            borderRadius: s(radii.xxl),
            minHeight: s(52),
        },
        variant === "primary" && {
            backgroundColor: colors.accent,
            ...shadow.accent,
        },
        variant === "secondary" && { backgroundColor: colors.muted },
        variant === "ghost" && { backgroundColor: "transparent" },
        variant === "danger" && {
            backgroundColor: "#fee2e2",
            borderWidth: 1.5,
            borderColor: colors.error,
        },
        fullWidth && { width: "100%" },
        isDisabled && { opacity: 0.5 },
        style,
    ];

    const labelStyles = [
        { fontSize: fs(16), fontWeight: "600" },
        variant === "primary" && { color: "#fff" },
        variant === "secondary" && { color: colors.foreground },
        variant === "ghost" && { color: colors.mutedForeground },
        variant === "danger" && { color: colors.error },
        labelStyle,
    ];

    const iconColor =
        variant === "primary"
            ? "#fff"
            : variant === "danger"
              ? colors.error
              : colors.accent;

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isDisabled}
            activeOpacity={0.8}
            style={containerStyles}
        >
            {loading ? (
                <ActivityIndicator
                    color={variant === "primary" ? "#fff" : colors.accent}
                    size="small"
                />
            ) : (
                <>
                    {icon && (
                        <Icon
                            name={icon}
                            size={s(18)}
                            color={iconColor}
                            style={{ marginRight: label ? s(6) : 0 }}
                        />
                    )}
                    {label && (
                        <Text style={labelStyles} allowFontScaling={false}>
                            {label}
                        </Text>
                    )}
                </>
            )}
        </TouchableOpacity>
    );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({
    children,
    style,
    onPress,
    selected = false,
    accent = false,
}) {
    const { s } = useScale();
    const cardStyles = [
        {
            backgroundColor: colors.card,
            borderRadius: s(radii.xxl),
            borderWidth: 2,
            borderColor: colors.border,
            padding: s(spacing.xl),
            ...shadow.sm,
        },
        selected && {
            borderColor: colors.accent,
            backgroundColor: "rgba(217,119,6,0.04)",
        },
        accent && { borderColor: colors.accent, ...shadow.accent },
        style,
    ];
    if (onPress) {
        return (
            <TouchableOpacity
                onPress={onPress}
                activeOpacity={0.85}
                style={cardStyles}
            >
                {children}
            </TouchableOpacity>
        );
    }
    return <View style={cardStyles}>{children}</View>;
}

// ─── AccentCard ───────────────────────────────────────────────────────────────
export function AccentCard({ children, style, onPress }) {
    const { s } = useScale();
    const inner = (
        <View
            style={[
                {
                    borderRadius: s(radii.xxl),
                    borderWidth: 2,
                    borderColor: colors.accent,
                    backgroundColor: "rgba(217,119,6,0.08)",
                    padding: s(spacing.xl),
                    ...shadow.accent,
                },
                style,
            ]}
        >
            {children}
        </View>
    );
    if (onPress)
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
                {inner}
            </TouchableOpacity>
        );
    return inner;
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ label, variant = "accent", style }) {
    const { s, fs } = useScale();
    const bgMap = {
        accent: colors.accent,
        success: colors.success,
        warning: colors.warning,
        muted: colors.muted,
    };
    const txtMap = {
        accent: "#fff",
        success: "#fff",
        warning: colors.warningText,
        muted: colors.mutedForeground,
    };
    return (
        <View
            style={[
                {
                    paddingHorizontal: s(spacing.md),
                    paddingVertical: s(3),
                    borderRadius: s(radii.full),
                    backgroundColor: bgMap[variant] || colors.accent,
                    ...(variant === "warning"
                        ? { borderWidth: 1, borderColor: "#fde68a" }
                        : {}),
                },
                style,
            ]}
        >
            <Text
                style={{
                    fontSize: fs(12),
                    fontWeight: "600",
                    color: txtMap[variant] || "#fff",
                }}
                allowFontScaling={false}
            >
                {label}
            </Text>
        </View>
    );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
export function SectionHeader({ title, icon, style }) {
    const { s, fs } = useScale();
    return (
        <View
            style={[
                {
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                },
                style,
            ]}
        >
            {icon && (
                <Icon
                    name={icon}
                    size={s(18)}
                    color={colors.accent}
                    style={{ marginRight: s(6) }}
                />
            )}
            <Text
                style={{
                    fontSize: fs(20),
                    fontWeight: "700",
                    color: colors.accent,
                }}
                allowFontScaling={false}
            >
                {title}
            </Text>
            {icon && (
                <Icon
                    name={icon}
                    size={s(18)}
                    color={colors.accent}
                    style={{ marginLeft: s(6) }}
                />
            )}
        </View>
    );
}

// ─── LoadingScreen ────────────────────────────────────────────────────────────
export function LoadingScreen({ message = "Loading..." }) {
    const { s, fs } = useScale();
    return (
        <View
            style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: s(spacing.xxl),
            }}
        >
            <ActivityIndicator size="large" color={colors.accent} />
            <Text
                style={{
                    fontSize: fs(16),
                    color: colors.mutedForeground,
                    marginTop: s(spacing.lg),
                }}
                allowFontScaling={false}
            >
                {message}
            </Text>
        </View>
    );
}

// ─── ErrorScreen ─────────────────────────────────────────────────────────────
export function ErrorScreen({ message, onRetry }) {
    const { s, fs } = useScale();
    return (
        <View
            style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                padding: s(spacing.xxl),
            }}
        >
            <Text style={{ fontSize: s(56), color: colors.mutedForeground }}>
                ✗
            </Text>
            <Text
                style={{
                    fontSize: fs(20),
                    fontWeight: "700",
                    color: colors.error,
                    marginTop: s(spacing.lg),
                    marginBottom: s(spacing.sm),
                    textAlign: "center",
                }}
                allowFontScaling={false}
            >
                Something went wrong
            </Text>
            <Text
                style={{
                    fontSize: fs(16),
                    color: colors.mutedForeground,
                    textAlign: "center",
                    marginHorizontal: s(spacing.xxl),
                    marginBottom: s(spacing.xxl),
                }}
                allowFontScaling={false}
            >
                {message}
            </Text>
            {onRetry && <Button label="Try Again" onPress={onRetry} />}
        </View>
    );
}

// ─── ModalSheet ───────────────────────────────────────────────────────────────
export function ModalSheet({
    visible,
    onClose,
    title,
    children,
    maxHeight = "90%",
}) {
    const { s, fs } = useScale();
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
                onPress={onClose}
            />
            <View
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    maxHeight,
                    backgroundColor: "#fff",
                    borderTopLeftRadius: s(radii.xxl),
                    borderTopRightRadius: s(radii.xxl),
                    ...shadow.lg,
                }}
            >
                <View
                    style={{
                        width: s(40),
                        height: s(4),
                        borderRadius: s(2),
                        backgroundColor: colors.border,
                        alignSelf: "center",
                        marginTop: s(spacing.md),
                    }}
                />
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: s(spacing.xxl),
                        paddingVertical: s(spacing.lg),
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                    }}
                >
                    <Text
                        style={{ fontSize: fs(20), fontWeight: "700" }}
                        allowFontScaling={false}
                    >
                        {title}
                    </Text>
                    <TouchableOpacity
                        onPress={onClose}
                        style={{ padding: s(spacing.sm) }}
                    >
                        <Icon
                            name="close"
                            size={s(22)}
                            color={colors.mutedForeground}
                        />
                    </TouchableOpacity>
                </View>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ padding: s(spacing.xxl) }}
                >
                    {children}
                </ScrollView>
            </View>
        </Modal>
    );
}

// ─── StepIndicator ────────────────────────────────────────────────────────────
// compact=true → used in tablet single-row header: smaller circles, no labels, tight connectors
export function StepIndicator({ steps, currentStep, compact = false }) {
    const { s, fs, W } = useScale();

    if (compact) {
        // Tablet compact: numbered circles in a row, connector lines between them,
        // step name as a single trailing label showing the current step only.
        // Using fixed sizes (no scaling) so nothing balloons on tablet.
        const CIRCLE = 22;
        const GAP = 40; // connector width between circles
        return (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
                {steps.map((label, i) => (
                    <React.Fragment key={i}>
                        <View style={{ alignItems: "center", width: CIRCLE }}>
                            <View
                                style={{
                                    width: CIRCLE,
                                    height: CIRCLE,
                                    borderRadius: CIRCLE / 2,
                                    backgroundColor:
                                        i <= currentStep
                                            ? colors.accent
                                            : colors.muted,
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "700",
                                        color:
                                            i <= currentStep
                                                ? "#fff"
                                                : colors.mutedForeground,
                                    }}
                                    allowFontScaling={false}
                                >
                                    {i + 1}
                                </Text>
                            </View>
                        </View>
                        {i < steps.length - 1 && (
                            <View
                                style={{
                                    width: GAP,
                                    height: 2,
                                    backgroundColor:
                                        i < currentStep
                                            ? colors.accent
                                            : colors.muted,
                                }}
                            />
                        )}
                    </React.Fragment>
                ))}
                {/* Current step name shown once, after all circles */}
                <Text
                    style={{
                        marginLeft: 12,
                        fontSize: 12,
                        fontWeight: "700",
                        color: colors.accent,
                    }}
                    allowFontScaling={false}
                >
                    {steps[currentStep]}
                </Text>
            </View>
        );
    }

    // Default full indicator
    const lineW = Math.max(
        s(24),
        (W - steps.length * s(64)) / (steps.length - 1) - s(8),
    );
    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            {steps.map((label, i) => (
                <React.Fragment key={i}>
                    <View style={{ alignItems: "center", gap: s(4) }}>
                        <View
                            style={{
                                width: s(34),
                                height: s(34),
                                borderRadius: s(17),
                                backgroundColor:
                                    i <= currentStep
                                        ? colors.accent
                                        : colors.muted,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: fs(14),
                                    fontWeight: "600",
                                    color:
                                        i <= currentStep
                                            ? "#fff"
                                            : colors.mutedForeground,
                                }}
                                allowFontScaling={false}
                            >
                                {i + 1}
                            </Text>
                        </View>
                        <Text
                            style={{
                                fontSize: fs(12),
                                color:
                                    i <= currentStep
                                        ? colors.foreground
                                        : colors.mutedForeground,
                                fontWeight: i <= currentStep ? "600" : "400",
                            }}
                            allowFontScaling={false}
                        >
                            {label}
                        </Text>
                    </View>
                    {i < steps.length - 1 && (
                        <View
                            style={{
                                width: lineW,
                                height: s(4),
                                borderRadius: s(2),
                                backgroundColor:
                                    i < currentStep
                                        ? colors.accent
                                        : colors.muted,
                                marginBottom: s(20),
                            }}
                        />
                    )}
                </React.Fragment>
            ))}
        </View>
    );
}

// ─── FormInput ────────────────────────────────────────────────────────────────
export function FormInput({ label, required, style, ...inputProps }) {
    const [focused, setFocused] = React.useState(false);
    const { s, fs } = useScale();
    return (
        <View style={[{ marginBottom: s(spacing.xl) }, style]}>
            {label && (
                <Text
                    style={{
                        fontSize: fs(16),
                        fontWeight: "600",
                        marginBottom: s(spacing.sm),
                    }}
                    allowFontScaling={false}
                >
                    {label}
                    {required && (
                        <Text style={{ color: colors.error }}> *</Text>
                    )}
                </Text>
            )}
            <TextInput
                style={{
                    borderWidth: 2,
                    borderColor: focused ? colors.accent : colors.border,
                    borderRadius: s(radii.lg),
                    paddingHorizontal: s(spacing.xl),
                    paddingVertical: s(spacing.lg),
                    fontSize: fs(16),
                    color: colors.foreground,
                    backgroundColor: "#fff",
                    minHeight: s(52),
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholderTextColor={colors.mutedForeground}
                allowFontScaling={false}
                {...inputProps}
            />
        </View>
    );
}

// ─── Divider ─────────────────────────────────────────────────────────────────
export function Divider({ style }) {
    return (
        <View style={[{ height: 1, backgroundColor: colors.border }, style]} />
    );
}
