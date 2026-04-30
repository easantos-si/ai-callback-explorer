import { IsString, MaxLength, MinLength } from 'class-validator';

export class CaptchaSolveDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  answer!: string;
}
