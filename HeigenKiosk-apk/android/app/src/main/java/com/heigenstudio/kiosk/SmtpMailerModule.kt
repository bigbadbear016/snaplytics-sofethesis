package com.heigenstudio.kiosk

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Properties
import java.util.concurrent.Executors
import javax.mail.Authenticator
import javax.mail.Message
import javax.mail.PasswordAuthentication
import javax.mail.Session
import javax.mail.Transport
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeBodyPart
import javax.mail.internet.MimeMessage
import javax.mail.internet.MimeMultipart

/** Standalone kiosk SMTP (same credentials as Django HEIGEN_SMTP_* in .env). */
class SmtpMailerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "SmtpMailer"

    @ReactMethod
    fun sendMail(
        host: String,
        port: Double,
        user: String,
        password: String,
        useTls: Boolean,
        fromEmail: String,
        fromName: String,
        toEmail: String,
        subject: String,
        plainBody: String,
        htmlBody: String,
        promise: Promise,
    ) {
        val smtpHost = host.trim()
        val smtpUser = user.trim()
        val smtpPass = password.replace(" ", "")
        val from = fromEmail.trim()
        val to = toEmail.trim()
        if (smtpHost.isEmpty() || smtpUser.isEmpty() || smtpPass.isEmpty() || from.isEmpty() || to.isEmpty()) {
            promise.reject("E_SMTP_CONFIG", "SMTP host, user, password, from, and to are required", null)
            return
        }
        val smtpPort = if (port.isNaN() || port <= 0) 587 else port.toInt()

        executor.execute {
            try {
                val props = Properties()
                props["mail.transport.protocol"] = "smtp"
                props["mail.smtp.host"] = smtpHost
                props["mail.smtp.port"] = smtpPort.toString()
                props["mail.smtp.auth"] = "true"
                props["mail.smtp.starttls.enable"] = if (useTls) "true" else "false"
                props["mail.smtp.starttls.required"] = if (useTls) "true" else "false"
                props["mail.smtp.ssl.protocols"] = "TLSv1.2"
                props["mail.smtp.connectiontimeout"] = "20000"
                props["mail.smtp.timeout"] = "20000"
                props["mail.smtp.writetimeout"] = "20000"

                val session = Session.getInstance(
                    props,
                    object : Authenticator() {
                        override fun getPasswordAuthentication(): PasswordAuthentication {
                            return PasswordAuthentication(smtpUser, smtpPass)
                        }
                    },
                )

                val message = MimeMessage(session)
                val fromAddr = InternetAddress(from, fromName.ifBlank { "Heigen Studio" })
                message.setFrom(fromAddr)
                message.setRecipient(Message.RecipientType.TO, InternetAddress(to))
                message.subject = subject.ifBlank { "Heigen Studio booking" }

                val alt = MimeMultipart("alternative")
                val textPart = MimeBodyPart()
                textPart.setText(plainBody.ifBlank { subject }, "utf-8")
                alt.addBodyPart(textPart)

                val htmlPart = MimeBodyPart()
                htmlPart.setContent(
                    if (htmlBody.isNotBlank()) htmlBody else plainBody,
                    "text/html; charset=utf-8",
                )
                alt.addBodyPart(htmlPart)

                message.setContent(alt)
                Transport.send(message)
                promise.resolve(true)
            } catch (e: Throwable) {
                promise.reject("SMTP_ERROR", e.message ?: e.javaClass.simpleName, e)
            }
        }
    }
}
