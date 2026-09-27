import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @IsNotEmpty()
  password!: string
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name!: string

  @IsEmail()
  email!: string

  @IsString()
  @MinLength(6)
  password!: string
}

/** Step 1 of the OTP signup: email + the password the account will get. */
export class SignupStartDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(6)
  password!: string
}

/** Step 2: the 6-digit code emailed to the address from SignupStartDto. */
export class SignupVerifyDto {
  @IsEmail()
  email!: string

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp!: string
}

/** All fields optional - only the ones provided are updated. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceName?: string
}