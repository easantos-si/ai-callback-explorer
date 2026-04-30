import { IsString, MaxLength, MinLength } from 'class-validator';

export class QrRevealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
