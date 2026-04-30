import { IsString, MaxLength, Matches } from 'class-validator';

export class RemoveOriginDto {
  @IsString()
  @MaxLength(253)
  @Matches(/^https?:\/\/[A-Za-z0-9._-]+(:\d{1,5})?$/, {
    message: 'Origin must be a valid http(s) URL with no path or query',
  })
  origin!: string;
}
