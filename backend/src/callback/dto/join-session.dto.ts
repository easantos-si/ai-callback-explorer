import { IsString, Matches } from 'class-validator';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class JoinSessionDto {
  @IsString()
  @Matches(UUID_V4, { message: 'sessionId must be a UUID v4' })
  sessionId!: string;
}
