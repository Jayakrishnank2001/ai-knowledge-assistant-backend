import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

export interface SignupMail {
  to: string
  code: string
}

const OTP_TTL_MINUTES = 10

/**
 * Sends the 6-digit signup OTP through the Resend HTTP API.
 *
 * Configured with RESEND_API_KEY (plus MAIL_FROM for the sender address) in
 * the backend .env.
 *
 * Until Resend is configured the service falls back to a development mode:
 * the code is logged to the backend console and handed back to the caller
 * so the flow stays testable locally. In production, a missing API key is a
 * hard error - an OTP signup that cannot send email must not silently
 * "succeed".
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  /**
   * Email the code to the user.
   *
   * Returns the code itself only in the unconfigured dev fallback - the
   * caller may surface it as a hint. Real sends resolve with null.
   */
  async sendSignupOtp(mail: SignupMail): Promise<string | null> {
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email service is not configured - signup is unavailable on this server.',
        )
      }
      this.logger.warn(`Signup code for ${mail.to}: ${mail.code} (valid ${OTP_TTL_MINUTES} min)`)
      return mail.code
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000) // fail fast instead of hanging

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM, // e.g. 'Nexa AI <noreply@yourdomain.com>'
          to: [mail.to],
          subject: 'Your Nexa AI signup code',
          text: `Your verification code is ${mail.code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
          html: [
            '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">',
            '<h2 style="color: #201b29;">Verify your email</h2>',
            '<p>Enter this code to finish creating your Nexa AI account:</p>',
            `<p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #9b6aff;">${mail.code}</p>`,
            `<p style="color: #666;">The code expires in ${OTP_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.</p>`,
            '</div>',
          ].join(''),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new Error(`Resend responded ${res.status}: ${await res.text()}`)
      }
    } catch (error) {
      this.logger.error(`Failed to send signup OTP to ${mail.to}: ${(error as Error).message}`)
      throw new ServiceUnavailableException(
        'Could not send the verification email - please try again in a moment',
      )
    } finally {
      clearTimeout(timer)
    }
    return null
  }
}