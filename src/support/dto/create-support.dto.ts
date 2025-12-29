import { IsEmail, IsNotEmpty, IsString, IsEnum } from 'class-validator';

export class CreateSupportDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    userType: string;

    @IsString()
    @IsNotEmpty()
    issueCategory: string;

    @IsString()
    @IsNotEmpty()
    message: string;
}
