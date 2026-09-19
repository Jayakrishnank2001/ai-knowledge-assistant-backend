import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator'

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