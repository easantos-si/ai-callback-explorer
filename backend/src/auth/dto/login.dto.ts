import { IsString, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MaxLength(128)
  captchaToken!: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'TOTP code must be exactly 6 digits',
  })
  totp!: string;
}
