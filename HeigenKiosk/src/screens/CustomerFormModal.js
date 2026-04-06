// src/screens/CustomerFormModal.js
import React, {
    createElement,
    useEffect,
    useState,
    useRef,
    useCallback,
} from "react";
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

/** Digits only for PH mobile validation. */
function contactDigitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}

/**
 * Philippine mobile: after stripping non-digits —
 *   639… → exactly 12 digits
 *   09…  → exactly 11 digits
 *   9…   → exactly 10 digits (e.g. 9171234567)
 */
function validatePhilippineMobile(value) {
    const raw = String(value || "").trim();
    if (!raw) return "Contact number is required";
    const d = contactDigitsOnly(raw);
    if (d.startsWith("639")) {
        if (d.length === 12) return null;
        return "639 numbers must be exactly 12 digits (e.g. 639171234567)";
    }
    if (d.startsWith("09")) {
        if (d.length === 11) return null;
        return "Numbers starting with 09 must be exactly 11 digits";
    }
    if (d.startsWith("9")) {
        if (d.length === 10) return null;
        return "Numbers starting with 9 must be exactly 10 digits (e.g. 9171234567)";
    }
    return "Use 09… (11 digits), 9… (10 digits), or 639… (12 digits)";
}

/** Popular domains for kiosk tap-to-complete (max `limit` suggestions). */
const EMAIL_DOMAIN_SUGGESTIONS = ["gmail.com", "yahoo.com", "outlook.com"];

/** Split "user@domain" for dropdown row styling. */
function suggestionParts(full) {
    const i = full.indexOf("@");
    if (i < 0) return { local: full, domain: "" };
    return {
        local: full.slice(0, i),
        domain: full.slice(i + 1),
    };
}

function buildEmailDomainSuggestions(raw, limit = 3) {
    const t = String(raw || "").trim().toLowerCase();
    if (!t || /\s/.test(t)) return [];
    const at = t.indexOf("@");
    if (at === -1) {
        return EMAIL_DOMAIN_SUGGESTIONS.slice(0, limit).map((d) => `${t}@${d}`);
    }
    const local = t.slice(0, at);
    const rest = t.slice(at + 1);
    if (!local) return [];
    if (rest === "") {
        return EMAIL_DOMAIN_SUGGESTIONS.slice(0, limit).map((d) => `${local}@${d}`);
    }
    const prefixMatches = EMAIL_DOMAIN_SUGGESTIONS.filter((d) =>
        d.startsWith(rest),
    );
    const ordered = [];
    for (const d of prefixMatches) {
        if (ordered.length >= limit) break;
        ordered.push(d);
    }
    for (const d of EMAIL_DOMAIN_SUGGESTIONS) {
        if (ordered.length >= limit) break;
        if (!ordered.includes(d)) ordered.push(d);
    }
    return ordered.slice(0, limit).map((d) => `${local}@${d}`);
}

function EmailDomainSuggestionChips({
    email,
    onPick,
    disabled,
    s,
    fs,
    isTablet,
}) {
    const suggestions = React.useMemo(
        () => buildEmailDomainSuggestions(email, 3),
        [email],
    );
    const alreadyValid = validateEmailFormat(email) === null;
    if (alreadyValid || suggestions.length === 0) return null;

    const rowPadV = isTablet ? 10 : s(11);
    const rowPadH = isTablet ? 12 : s(14);
    const rowFs = isTablet ? 13 : fs(14);
    const headerFs = isTablet ? 10 : fs(10);

    return (
        <View
            style={{
                marginTop: isTablet ? 4 : s(4),
                borderRadius: isTablet ? radii.md : s(radii.md),
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                overflow: "hidden",
                opacity: disabled ? 0.5 : 1,
                ...shadow.sm,
            }}
        >
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: isTablet ? 7 : s(8),
                    paddingHorizontal: rowPadH,
                    backgroundColor: colors.backgroundElevated,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                }}
            >
                <Text
                    style={{
                        fontSize: headerFs,
                        fontWeight: "800",
                        color: colors.mutedForeground,
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                    }}
                    allowFontScaling={false}
                >
                    Suggestions
                </Text>
                <Icon
                    name="chevron-down"
                    size={isTablet ? 14 : s(14)}
                    color={colors.mutedForeground}
                />
            </View>
            {suggestions.map((full, idx) => {
                const { local, domain } = suggestionParts(full);
                return (
                    <TouchableOpacity
                        key={full}
                        onPress={() => onPick(full)}
                        activeOpacity={0.75}
                        disabled={disabled}
                        style={{
                            paddingVertical: rowPadV,
                            paddingHorizontal: rowPadH,
                            borderBottomWidth:
                                idx < suggestions.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            backgroundColor: colors.card,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: rowFs,
                                color: colors.foreground,
                            }}
                            allowFontScaling={false}
                            numberOfLines={1}
                            ellipsizeMode="middle"
                        >
                            <Text style={{ fontWeight: "600" }}>{local}</Text>
                            <Text
                                style={{
                                    fontWeight: "800",
                                    color: colors.primary,
                                }}
                            >
                                @{domain}
                            </Text>
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
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

    const pickEmailDomain = useCallback((full) => {
        setForm((prev) => ({ ...prev, email: full }));
        setErrors((prev) => ({ ...prev, email: null }));
    }, []);

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

    function validateContactOnBlur() {
        const msg = validatePhilippineMobile(formRef.current.contactNumber);
        setErrors((prev) => {
            const next = { ...prev };
            if (msg) next.contactNumber = msg;
            else delete next.contactNumber;
            return next;
        });
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
        const phoneErr = validatePhilippineMobile(form.contactNumber);
        if (phoneErr) e.contactNumber = phoneErr;
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function handleSubmit() {
        if (!validate()) return;
        onSubmit({
            fullName: form.fullName.trim(),
            email: form.email.trim().toLowerCase(),
            contactNumber: contactDigitsOnly(form.contactNumber),
            preferredDate: form.preferredDate.trim() || null,
            consentGiven: form.consentGiven,
        });
    }

    const isValidEmail = !validateEmailFormat(form.email);
    const contactOk = validatePhilippineMobile(form.contactNumber) === null;
    const isValid =
        !!form.fullName?.trim() &&
        !!form.email?.trim() &&
        contactOk;

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
                                            <EmailDomainSuggestionChips
                                                email={form.email}
                                                onPick={pickEmailDomain}
                                                disabled={checkingEmail}
                                                s={s}
                                                fs={fs}
                                                isTablet
                                            />
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
                                        <EmailDomainSuggestionChips
                                            email={form.email}
                                            onPick={pickEmailDomain}
                                            disabled={checkingEmail}
                                            s={s}
                                            fs={fs}
                                            isTablet
                                        />
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
                                            placeholder="e.g. 09171234567"
                                            keyboardType="phone-pad"
                                            placeholderTextColor={
                                                colors.mutedForeground
                                            }
                                            allowFontScaling={false}
                                            onFocus={() =>
                                                setFocused("contact")
                                            }
                                            onBlur={() => {
                                                setFocused("");
                                                validateContactOnBlur();
                                            }}
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
                                <EmailDomainSuggestionChips
                                    email={form.email}
                                    onPick={pickEmailDomain}
                                    disabled={checkingEmail}
                                    s={s}
                                    fs={fs}
                                    isTablet={false}
                                />
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
                        <EmailDomainSuggestionChips
                            email={form.email}
                            onPick={pickEmailDomain}
                            disabled={checkingEmail}
                            s={s}
                            fs={fs}
                            isTablet={false}
                        />
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
                                onBlur={validateContactOnBlur}
                                placeholder="e.g. 09171234567"
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
