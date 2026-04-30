import { IsString, Matches, MaxLength } from 'class-validator';

export class QrShareDto {
  // Format: 32 hex chars (salt) + "." + 64 hex chars (HMAC) = 97 chars.
  @IsString()
  @MaxLength(120)
  @Matches(/^[0-9a-f]{32}\.[0-9a-f]{64}$/i, {
    message: 'Invalid share token',
  })
  token!: string;
}
