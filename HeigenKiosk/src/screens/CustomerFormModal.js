// src/screens/CustomerFormModal.js
import React, { createElement, useEffect, useState, useRef } from "react";
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Switch,
    Modal,
    Pressable,
    KeyboardAvoidingView,
    Platform,
    TextInput,
} from "react-native";
import Icon from "../components/Icon";

const DateTimePicker = Platform.OS !== "web"
    ? require("@react-native-community/datetimepicker").default
    : null;
import { Button } from "../components/ui";
import { colors, spacing, radii, shadow } from "../constants/theme";
import { useScale } from "../hooks/useScale";

// Solid email validation: RFC 5322–style format, length, structure
/** Map API customer (list/detail) to form fields; tolerates camelCase or snake_case. */
function mapCustomerFromApi(c) {
    if (!c || typeof c !== "object") return null;
    const name = String(c.name ?? c.full_name ?? "").trim();
    const contactRaw = c.contactNo ?? c.contact_number ?? c.phone ?? "";
    const contactNumber = String(contactRaw ?? "").trim();
    const email = String(c.email ?? "").trim().toLowerCase();
    const consentGiven = !!(
        c.consent &&
        String(c.consent).toLowerCase().includes("agree")
    );
    return { name, contactNumber, email, consentGiven };
}

function validateEmailFormat(email) {
    const trimmed = (email || "").trim();
    if (!trimmed) return "Email is required";
    if (trimmed.length > 254) return "Email is too long";
    // Local part + @ + domain with valid TLD (min 2 chars)
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!re.test(trimmed)) return "Please enter a valid email address";
    return null;
}

function formatDateForDisplay(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

function isoTodayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Web: HTML5 date input provides native date picker. Matches other input size/height.
function WebDatePicker({ value, onChange, minDate, isTablet, s, fs }) {
    const minStr = minDate ? minDate.toISOString().slice(0, 10) : "";
    const style = isTablet
        ? {
            width: "100%",
            minHeight: 40,
            borderWidth: "1.5px",
            borderStyle: "solid",
            borderColor: colors.border,
            borderRadius: 8,
            padding: "9px 12px",
            fontSize: 14,
            color: colors.foreground,
            backgroundColor: "#fff",
            cursor: "pointer",
            boxSizing: "border-box",
        }
        : {
            width: "100%",
            minHeight: 52,
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: colors.border,
            borderRadius: s ? s(radii.lg) : 16,
            padding: `${s ? s(spacing.lg) : 16}px ${s ? s(spacing.xl) : 20}px`,
            fontSize: fs ? fs(15) : 15,
            color: colors.foreground,
            backgroundColor: "#fff",
            cursor: "pointer",
            boxSizing: "border-box",
        };
    return createElement("input", {
        type: "date",
        value: value || "",
        min: minStr,
        onChange: (e) => onChange(e.target.value),
        style,
    });
}

export default function CustomerFormModal({
    visible,
    onClose,
    onSubmit,
    onCheckEmail,
    loading,
    requireSubmit = false,
    resetToken = 0,
}) {
    const { s, fs, isTablet, W, H } = useScale();
    const [step, setStep] = useState("email");
    const [form, setForm] = useState({
        fullName: "",
        email: "",
        contactNumber: "",
        preferredDate: isoTodayLocal(),
        consentGiven: false,
    });
    const [errors, setErrors] = useState({});
    const [focused, setFocused] = useState("");
    const [checkingEmail, setCheckingEmail] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const canClose = !requireSubmit && !loading && !checkingEmail;

    const prevVisibleRef = useRef(false);
    const formRef = useRef(form);
    const stepRef = useRef(step);
    useEffect(() => {
        formRef.current = form;
    }, [form]);
    useEffect(() => {
        stepRef.current = step;
    }, [step]);

    const preferredDateValue = form.preferredDate
        ? new Date(form.preferredDate)
        : new Date(isoTodayLocal());

    function handleDateChange(evt, selectedDate) {
        setShowDatePicker(Platform.OS === "ios");
        if (selectedDate) {
            const y = selectedDate.getFullYear();
            const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
            const d = String(selectedDate.getDate()).padStart(2, "0");
            set("preferredDate")(`${y}-${m}-${d}`);
        }
    }

    useEffect(() => {
        setStep("email");
        setForm({
            fullName: "",
            email: "",
            contactNumber: "",
            preferredDate: isoTodayLocal(),
            consentGiven: false,
        });
        setErrors({});
        setFocused("");
        setCheckingEmail(false);
        setShowDatePicker(false);
    }, [resetToken]);

    useEffect(() => {
        if (visible && !prevVisibleRef.current) {
            setStep("email");
            setForm({ fullName: "", email: "", contactNumber: "", preferredDate: isoTodayLocal(), consentGiven: false });
            setErrors({});
            setShowDatePicker(false);
        }
        prevVisibleRef.current = visible;
    }, [visible]);

    const set = (field) => (value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors((prev) => ({ ...prev, [field]: null }));
    };

    function validateEmailOnBlur() {
        const msg = validateEmailFormat(formRef.current.email);
        if (msg) setErrors((prev) => ({ ...prev, email: msg }));
    }

    /** When email is valid and we are on the details step, load name & phone from DB. */
    async function tryPrefillFromEmailLookup() {
        if (!onCheckEmail) return;
        if (stepRef.current !== "info") return;
        const trimmed = (formRef.current.email || "").trim().toLowerCase();
        if (validateEmailFormat(trimmed)) return;
        try {
            const result = await onCheckEmail(trimmed);
            if (!result?.found || !result?.customer) return;
            const m = mapCustomerFromApi(result.customer);
            if (!m) return;
            setForm((prev) => ({
                ...prev,
                fullName: m.name || prev.fullName,
                contactNumber: m.contactNumber || prev.contactNumber,
                email: m.email || prev.email,
                consentGiven: m.consentGiven,
            }));
        } catch (_) {
            /* ignore — user can still submit */
        }
    }

    function onEmailBlurStepEmail() {
        setFocused("");
        validateEmailOnBlur();
    }

    function onEmailBlurStepInfo() {
        setFocused("");
        validateEmailOnBlur();
        void tryPrefillFromEmailLookup();
    }

    function validateEmail() {
        const msg = validateEmailFormat(form.email);
        const e = msg ? { email: msg } : {};
        setErrors(e);
        return !msg;
    }

    async function handleEmailSubmit() {
        if (!validateEmail() || !onCheckEmail) return;
        setCheckingEmail(true);
        setErrors({});
        try {
            const result = await onCheckEmail(form.email.trim().toLowerCase());
            if (result?.found && result?.customer) {
                const m = mapCustomerFromApi(result.customer);
                setForm({
                    fullName: m?.name || "",
                    email: m?.email || form.email.trim().toLowerCase(),
                    contactNumber: m?.contactNumber || "",
                    preferredDate: isoTodayLocal(),
                    consentGiven: !!m?.consentGiven,
                });
            } else {
                setForm((prev) => ({
                    ...prev,
                    fullName: "",
                    contactNumber: "",
                    preferredDate: isoTodayLocal(),
                    consentGiven: false,
                }));
            }
            setStep("info");
        } catch (_) {
            setErrors({ email: "Could not check email. Please try again." });
        } finally {
            setCheckingEmail(false);
        }
    }

    function validate() {
        const e = {};
        if (!form.fullName.trim()) e.fullName = "Required";
        const emailErr = validateEmailFormat(form.email);
        if (emailErr) e.email = emailErr;
        if (!form.contactNumber.trim()) e.contactNumber = "Required";
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function handleSubmit() {
        if (!validate()) return;
        onSubmit({
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            contactNumber: form.contactNumber.trim(),
            preferredDate: form.preferredDate.trim() || null,
            consentGiven: form.consentGiven,
        });
    }

    const isValidEmail = !validateEmailFormat(form.email);
    const isValid = form.fullName && form.email && form.contactNumber;

    // ── TABLET: centered fixed dialog, no scroll ─────────────────────────────────
    // All sizes are raw dp values (not scaled) so they don't balloon on large screens
    if (isTablet) {
        const dialogW = Math.min(600, W * 0.75);
        const inp = (field) => ({
            borderWidth: 1.5,
            borderColor: focused === field ? colors.accent : colors.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
            minHeight: 40,
            fontSize: 14,
            color: colors.foreground,
            backgroundColor: "#fff",
        });

        return (
            <Modal
                visible={visible}
                transparent
                animationType="fade"
                onRequestClose={canClose ? onClose : undefined}
            >
                <Pressable
                    style={{
                        flex: 1,
                        backgroundColor: "rgba(0,0,0,0.55)",
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                    onPress={canClose ? onClose : undefined}
                >
                    <Pressable onPress={(e) => e.stopPropagation()}>
                        <View
                            style={{
                                width: dialogW,
                                backgroundColor: "#fff",
                                borderRadius: 16,
                                overflow: "hidden",
                                ...shadow.lg,
                            }}
                        >
                            {/* ── Header ── */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    paddingHorizontal: 20,
                                    paddingVertical: 14,
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 15,
                                        fontWeight: "700",
                                        color: colors.foreground,
                                    }}
                                    allowFontScaling={false}
                                >
                                    Customer Information
                                </Text>
                                {canClose ? (
                                    <TouchableOpacity
                                        onPress={onClose}
                                        style={{ padding: 6 }}
                                    >
                                        <Icon
                                            name="close"
                                            size={18}
                                            color={colors.mutedForeground}
                                        />
                                    </TouchableOpacity>
                                ) : null}
                            </View>

                            {/* ── Body ── */}
                            <View style={{ padding: 20, gap: 12 }}>
                                {step === "email" ? (
                                    <>
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: colors.mutedForeground,
                                                marginBottom: 8,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Enter your email to continue
                                        </Text>
                                        <View>
                                            <Text
                                                style={{
                                                    fontSize: 11,
                                                    fontWeight: "600",
                                                    color: colors.mutedForeground,
                                                    marginBottom: 5,
                                                    textTransform: "uppercase",
                                                    letterSpacing: 0.4,
                                                }}
                                                allowFontScaling={false}
                                            >
                                                Email{" "}
                                                <Text style={{ color: colors.error }}>*</Text>
                                            </Text>
                                            <TextInput
                                                style={inp("email")}
                                                value={form.email}
                                                onChangeText={set("email")}
                                                placeholder="example@email.com"
                                                keyboardType="email-address"
                                                autoCapitalize="none"
                                                placeholderTextColor={colors.mutedForeground}
                                                allowFontScaling={false}
                                                onFocus={() => setFocused("email")}
                                                onBlur={onEmailBlurStepEmail}
                                                editable={!checkingEmail}
                                                autoComplete={Platform.OS === "web" ? "off" : undefined}
                                                textContentType="none"
                                            />
                                            {errors.email ? (
                                                <Text style={{ fontSize: 10, color: colors.error, marginTop: 3 }}>{errors.email}</Text>
                                            ) : null}
                                        </View>
                                        <View style={{ flexDirection: "row", gap: 10 }}>
                                            {canClose ? (
                                                <Button label="Cancel" variant="secondary" onPress={onClose} size="sm" style={{ flex: 1, height: 40, minHeight: 0 }} disabled={checkingEmail} />
                                            ) : null}
                                            <Button label="Continue" onPress={handleEmailSubmit} disabled={!isValidEmail || checkingEmail} size="sm" loading={checkingEmail} style={{ flex: canClose ? 1 : 2, height: 40, minHeight: 0 }} />
                                        </View>
                                    </>
                                ) : (
                                    <>
                                {/* Row 1: Full Name + Email */}
                                <View style={{ flexDirection: "row", gap: 12 }}>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: colors.mutedForeground,
                                                marginBottom: 5,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.4,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Full Name{" "}
                                            <Text
                                                style={{ color: colors.error }}
                                            >
                                                *
                                            </Text>
                                        </Text>
                                        <TextInput
                                            style={inp("name")}
                                            value={form.fullName}
                                            onChangeText={set("fullName")}
                                            placeholder="Enter your full name"
                                            autoCapitalize="words"
                                            placeholderTextColor={
                                                colors.mutedForeground
                                            }
                                            allowFontScaling={false}
                                            onFocus={() => setFocused("name")}
                                            onBlur={() => setFocused("")}
                                            autoComplete={Platform.OS === "web" ? "name" : undefined}
                                            textContentType="name"
                                        />
                                        {errors.fullName ? (
                                            <Text
                                                style={{
                                                    fontSize: 10,
                                                    color: colors.error,
                                                    marginTop: 3,
                                                }}
                                            >
                                                {errors.fullName}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: colors.mutedForeground,
                                                marginBottom: 5,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.4,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Email{" "}
                                            <Text
                                                style={{ color: colors.error }}
                                            >
                                                *
                                            </Text>
                                        </Text>
                                        <TextInput
                                            style={inp("email")}
                                            value={form.email}
                                            onChangeText={set("email")}
                                            placeholder="example@email.com"
                                            keyboardType="email-address"
                                            autoCapitalize="none"
                                            placeholderTextColor={
                                                colors.mutedForeground
                                            }
                                            allowFontScaling={false}
                                            onFocus={() => setFocused("email")}
                                            onBlur={onEmailBlurStepInfo}
                                            autoComplete={Platform.OS === "web" ? "off" : undefined}
                                            textContentType="none"
                                        />
                                        {errors.email ? (
                                            <Text
                                                style={{
                                                    fontSize: 10,
                                                    color: colors.error,
                                                    marginTop: 3,
                                                }}
                                            >
                                                {errors.email}
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>

                                {/* Row 2: Contact + Preferred Date */}
                                <View style={{ flexDirection: "row", gap: 12 }}>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: colors.mutedForeground,
                                                marginBottom: 5,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.4,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Contact Number{" "}
                                            <Text
                                                style={{ color: colors.error }}
                                            >
                                                *
                                            </Text>
                                        </Text>
                                        <TextInput
                                            style={inp("contact")}
                                            value={form.contactNumber}
                                            onChangeText={set("contactNumber")}
                                            placeholder="+63 9XX XXX XXXX"
                                            keyboardType="phone-pad"
                                            placeholderTextColor={
                                                colors.mutedForeground
                                            }
                                            allowFontScaling={false}
                                            onFocus={() =>
                                                setFocused("contact")
                                            }
                                            onBlur={() => setFocused("")}
                                            autoComplete={Platform.OS === "web" ? "off" : undefined}
                                            textContentType="none"
                                        />
                                        {errors.contactNumber ? (
                                            <Text
                                                style={{
                                                    fontSize: 10,
                                                    color: colors.error,
                                                    marginTop: 3,
                                                }}
                                            >
                                                {errors.contactNumber}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                fontWeight: "600",
                                                color: colors.mutedForeground,
                                                marginBottom: 5,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.4,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            Preferred Date (optional)
                                        </Text>
                                        {DateTimePicker ? (
                                            <>
                                                <TouchableOpacity
                                                    onPress={() => setShowDatePicker(true)}
                                                    style={[inp("date"), { justifyContent: "center" }]}
                                                >
                                                    <Text
                                                        style={{
                                                            fontSize: 14,
                                                            color: form.preferredDate ? colors.foreground : colors.mutedForeground,
                                                        }}
                                                        allowFontScaling={false}
                                                    >
                                                        {form.preferredDate ? formatDateForDisplay(form.preferredDate) : "Select date"}
                                                    </Text>
                                                </TouchableOpacity>
                                                {showDatePicker && (
                                                    <View style={{ marginTop: 4 }}>
                                                        <DateTimePicker
                                                            value={preferredDateValue}
                                                            mode="date"
                                                            display={Platform.OS === "ios" ? "spinner" : "default"}
                                                            onChange={handleDateChange}
                                                        />
                                                        {Platform.OS === "ios" && (
                                                            <TouchableOpacity
                                                                onPress={() => setShowDatePicker(false)}
                                                                style={{ marginTop: 8, paddingVertical: 8, alignItems: "center", backgroundColor: colors.accent, borderRadius: 8 }}
                                                            >
                                                                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }} allowFontScaling={false}>Done</Text>
                                                            </TouchableOpacity>
                                                        )}
                                                    </View>
                                                )}
                                            </>
                                        ) : (
                                            <WebDatePicker
                                                value={form.preferredDate}
                                                onChange={(v) => set("preferredDate")(v)}
                                                isTablet={true}
                                            />
                                        )}
                                    </View>
                                </View>

                                {/* Consent */}
                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "flex-start",
                                        gap: 12,
                                        borderWidth: 1.5,
                                        borderColor: colors.border,
                                        borderRadius: 10,
                                        padding: 12,
                                        backgroundColor:
                                            "rgba(236,236,240,0.25)",
                                    }}
                                >
                                    <Switch
                                        value={form.consentGiven}
                                        onValueChange={set("consentGiven")}
                                        trackColor={{
                                            false: colors.muted,
                                            true: colors.accent,
                                        }}
                                        thumbColor="#fff"
                                    />
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: colors.mutedForeground,
                                                lineHeight: 17,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            I hereby consent to Heigen Studio
                                            releasing my photos on public and
                                            social media platforms.
                                        </Text>
                                    </View>
                                </View>

                                {/* Actions */}
                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <TouchableOpacity
                                        onPress={() => setStep("email")}
                                        style={{
                                            paddingVertical: 10,
                                            paddingHorizontal: 12,
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        <Text style={{ fontSize: 13, color: colors.mutedForeground }} allowFontScaling={false}>Back</Text>
                                    </TouchableOpacity>
                                    {canClose ? (
                                        <Button
                                            label="Cancel"
                                            variant="secondary"
                                            onPress={onClose}
                                            size="sm"
                                            style={{
                                                flex: 1,
                                                height: 40,
                                                minHeight: 0,
                                            }}
                                            disabled={loading}
                                        />
                                    ) : null}
                                    <Button
                                        label="Continue"
                                        onPress={handleSubmit}
                                        disabled={!isValid || loading}
                                        size="sm"
                                        loading={loading}
                                        style={{
                                            flex: canClose ? 1 : 2,
                                            height: 40,
                                            minHeight: 0,
                                        }}
                                    />
                                </View>
                                    </>
                                )}
                            </View>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>
        );
    }

    // ── PHONE: bottom sheet with scroll ──────────────────────────────────────────
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={canClose ? onClose : undefined}
        >
            <Pressable
                style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
                onPress={canClose ? onClose : undefined}
            />
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
            >
                <View
                    style={{
                        backgroundColor: "#fff",
                        borderTopLeftRadius: s(radii.xxl),
                        borderTopRightRadius: s(radii.xxl),
                        maxHeight: "92%",
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
                            style={{ fontSize: fs(18), fontWeight: "700" }}
                            allowFontScaling={false}
                        >
                            Customer Information
                        </Text>
                        {canClose ? (
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
                        ) : null}
                    </View>
                    <ScrollView
                        contentContainerStyle={{
                            padding: s(spacing.xxl),
                            paddingBottom: s(spacing.xxxl),
                        }}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {step === "email" ? (
                            <>
                                <Text style={{ fontSize: fs(14), color: colors.mutedForeground, marginBottom: s(spacing.lg) }} allowFontScaling={false}>
                                    Enter your email to continue
                                </Text>
                                <PhoneField label="Email Address" required error={errors.email} s={s} fs={fs}>
                                    <PhoneInput
                                        value={form.email}
                                        onChangeText={set("email")}
                                        onBlur={onEmailBlurStepEmail}
                                        placeholder="example@email.com"
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        s={s}
                                        fs={fs}
                                        autoComplete={Platform.OS === "web" ? "off" : undefined}
                                        textContentType="none"
                                    />
                                </PhoneField>
                                <View style={{ flexDirection: "row", gap: s(spacing.lg), marginTop: s(spacing.lg) }}>
                                    {canClose ? (
                                        <Button label="Cancel" variant="secondary" onPress={onClose} size="sm" style={{ flex: 1 }} disabled={checkingEmail} />
                                    ) : null}
                                    <Button label="Continue" onPress={handleEmailSubmit} disabled={!isValidEmail || checkingEmail} size="sm" loading={checkingEmail} style={{ flex: canClose ? 1 : 2 }} />
                                </View>
                            </>
                        ) : (
                            <>
                        <TouchableOpacity onPress={() => setStep("email")} style={{ marginBottom: s(spacing.lg) }}>
                            <Text style={{ fontSize: fs(13), color: colors.mutedForeground }} allowFontScaling={false}>← Back</Text>
                        </TouchableOpacity>
                        <PhoneField
                            label="Full Name"
                            required
                            error={errors.fullName}
                            s={s}
                            fs={fs}
                        >
                            <PhoneInput
                                value={form.fullName}
                                onChangeText={set("fullName")}
                                placeholder="Enter your full name"
                                autoCapitalize="words"
                                s={s}
                                fs={fs}
                                autoComplete={Platform.OS === "web" ? "name" : undefined}
                                textContentType="name"
                            />
                        </PhoneField>
                        <PhoneField
                            label="Email Address"
                            required
                            error={errors.email}
                            s={s}
                            fs={fs}
                        >
                            <PhoneInput
                                value={form.email}
                                onChangeText={set("email")}
                                onBlur={onEmailBlurStepInfo}
                                placeholder="example@email.com"
                                keyboardType="email-address"
                                autoCapitalize="none"
                                s={s}
                                fs={fs}
                                autoComplete={Platform.OS === "web" ? "off" : undefined}
                                textContentType="none"
                            />
                        </PhoneField>
                        <PhoneField
                            label="Contact Number"
                            required
                            error={errors.contactNumber}
                            s={s}
                            fs={fs}
                        >
                            <PhoneInput
                                value={form.contactNumber}
                                onChangeText={set("contactNumber")}
                                placeholder="+63 9XX XXX XXXX"
                                keyboardType="phone-pad"
                                s={s}
                                fs={fs}
                                autoComplete={Platform.OS === "web" ? "off" : undefined}
                                textContentType="none"
                            />
                        </PhoneField>
                        <PhoneField
                            label="Preferred Date (optional)"
                            s={s}
                            fs={fs}
                        >
                            {DateTimePicker ? (
                                <>
                                    <TouchableOpacity
                                        onPress={() => setShowDatePicker(true)}
                                        style={{
                                            borderWidth: 2,
                                            borderColor: colors.border,
                                            borderRadius: s(radii.lg),
                                            paddingHorizontal: s(spacing.xl),
                                            paddingVertical: s(spacing.lg),
                                            minHeight: 52,
                                            justifyContent: "center",
                                            backgroundColor: "#fff",
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: fs(15),
                                                color: form.preferredDate ? colors.foreground : colors.mutedForeground,
                                            }}
                                            allowFontScaling={false}
                                        >
                                            {form.preferredDate ? formatDateForDisplay(form.preferredDate) : "Select date"}
                                        </Text>
                                    </TouchableOpacity>
                                    {showDatePicker && (
                                        <View style={{ marginTop: s(spacing.sm) }}>
                                            <DateTimePicker
                                                value={preferredDateValue}
                                                mode="date"
                                                display={Platform.OS === "ios" ? "spinner" : "default"}
                                                onChange={handleDateChange}
                                            />
                                            {Platform.OS === "ios" && (
                                                <TouchableOpacity
                                                    onPress={() => setShowDatePicker(false)}
                                                    style={{ marginTop: s(spacing.md), paddingVertical: s(spacing.md), alignItems: "center", backgroundColor: colors.accent, borderRadius: s(radii.lg) }}
                                                >
                                                    <Text style={{ color: "#fff", fontWeight: "600", fontSize: fs(14) }} allowFontScaling={false}>Done</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )}
                                </>
                            ) : (
                                <WebDatePicker
                                    value={form.preferredDate}
                                    onChange={(v) => set("preferredDate")(v)}
                                    isTablet={false}
                                    s={s}
                                    fs={fs}
                                />
                            )}
                        </PhoneField>
                        <View
                            style={{
                                backgroundColor: "rgba(236,236,240,0.4)",
                                borderWidth: 2,
                                borderColor: colors.border,
                                borderRadius: s(radii.xl),
                                padding: s(spacing.xl),
                                marginBottom: s(spacing.xl),
                            }}
                        >
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "flex-start",
                                    gap: s(spacing.lg),
                                }}
                            >
                                <Switch
                                    value={form.consentGiven}
                                    onValueChange={set("consentGiven")}
                                    trackColor={{
                                        false: colors.muted,
                                        true: colors.accent,
                                    }}
                                    thumbColor="#fff"
                                />
                                <Text
                                    style={{
                                        fontSize: fs(13),
                                        color: colors.mutedForeground,
                                        flex: 1,
                                        lineHeight: fs(19),
                                    }}
                                    allowFontScaling={false}
                                >
                                    I hereby consent to Heigen Studio releasing
                                    my photos on public and social media
                                    platforms.
                                </Text>
                            </View>
                        </View>
                        <View
                            style={{ flexDirection: "row", gap: s(spacing.lg) }}
                        >
                            {canClose ? (
                                <Button
                                    label="Cancel"
                                    variant="secondary"
                                    onPress={onClose}
                                    size="sm"
                                    style={{ flex: 1 }}
                                    disabled={loading}
                                />
                            ) : null}
                            <Button
                                label="Continue"
                                onPress={handleSubmit}
                                disabled={!isValid || loading}
                                size="sm"
                                loading={loading}
                                style={{ flex: canClose ? 1 : 2 }}
                            />
                        </View>
                            </>
                        )}
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function PhoneField({ label, required, error, children, s, fs }) {
    return (
        <View style={{ marginBottom: s(spacing.xl) }}>
            <Text
                style={{
                    fontSize: fs(14),
                    fontWeight: "600",
                    marginBottom: s(spacing.sm),
                }}
                allowFontScaling={false}
            >
                {label}
                {required ? (
                    <Text style={{ color: colors.error }}> *</Text>
                ) : null}
            </Text>
            {children}
            {error ? (
                <Text
                    style={{
                        fontSize: fs(11),
                        color: colors.error,
                        marginTop: s(4),
                    }}
                >
                    {error}
                </Text>
            ) : null}
        </View>
    );
}

function PhoneInput({ s, fs, onFocus, onBlur, ...rest }) {
    const [focused, setFocused] = useState(false);
    return (
        <TextInput
            style={{
                borderWidth: 2,
                borderColor: focused ? colors.accent : colors.border,
                borderRadius: s(radii.lg),
                paddingHorizontal: s(spacing.xl),
                paddingVertical: s(spacing.lg),
                minHeight: 52,
                fontSize: fs(15),
                color: colors.foreground,
                backgroundColor: "#fff",
            }}
            onFocus={(e) => { setFocused(true); onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); onBlur?.(e); }}
            placeholderTextColor={colors.mutedForeground}
            allowFontScaling={false}
            {...rest}
        />
    );
}
