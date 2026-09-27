import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { createTransport, Transporter } from 'nodemailer'

export interface SignupMail {
  to: string
  code: string
}

const OTP_TTL_MINUTES = 10

/**
 * Sends the 6-digit signup OTP over SMTP.
 *
 * SMTP is configured with SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 * (plus optional SMTP_FROM) in the backend .env.
 *
 * Until SMTP is configured the service falls back to a development mode:
 * the code is logged to the backend console and handed back to the caller
 * so the flow stays testable locally. In production, a missing SMTP config
 * is a hard error - an OTP signup that cannot send email must not silently
 * "succeed".
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly transporter: Transporter | null

  constructor() {
    const { host, port, user, pass } = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    }

    this.transporter =
      host && user && pass
        ? createTransport({ host, port, secure: port === 465, auth: { user, pass } })
        : null

    if (!this.transporter) {
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) - signup codes will be ' +
          'printed to this console instead of being emailed.',
      )
    }
  }

  /** True when real emails will be sent (i.e. SMTP credentials exist). */
  get isSmtpConfigured(): boolean {
    return this.transporter !== null
  }

  /**
   * Email the code to the user.
   *
   * Returns the code itself only in the unconfigured dev fallback - the
   * caller may surface it as a hint. Real sends resolve with null.
   */
  async sendSignupOtp(mail: SignupMail): Promise<string | null> {
    if (!this.transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email service is not configured - signup is unavailable on this server.',
        )
      }
      this.logger.warn(`Signup code for ${mail.to}: ${mail.code} (valid ${OTP_TTL_MINUTES} min)`)
      return mail.code
    }

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to: mail.to,
        subject: 'Your Nexa AI signup code',
        text: `Your verification code is ${mail.code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        html: [
          '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">',
          '<h2 style="color: #201b29;">Verify your email</h2>',
          `<p>Enter this code to finish creating your Nexa AI account:</p>`,
          `<p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #9b6aff;">${mail.code}</p>`,
          `<p style="color: #666;">The code expires in ${OTP_TTL_MINUTES} minutes. ` +
            'If you did not request it, you can ignore this email.</p>',
          '</div>',
        ].join(''),
      })
    } catch (error) {
      // SMTP rejected the send (bad credentials, network down, provider outage).
      // Log the full cause server-side but never leak it to the client - a raw
      // nodemailer error would expose host/credential details in the response.
      this.logger.error(`Failed to send signup OTP to ${mail.to}: ${(error as Error).message}`)
      throw new ServiceUnavailableException(
        'Could not send the verification email - please try again in a moment',
      )
    }
    return null
  }
}