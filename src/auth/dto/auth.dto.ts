import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator'

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