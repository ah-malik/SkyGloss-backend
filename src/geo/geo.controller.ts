import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GeoService } from './geo.service';

@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('address-autocomplete')
  @UseGuards(JwtAuthGuard)
  autocompleteAddress(
    @Query('text') text: string,
    @Query('country') country?: string,
    @Query('near') near?: string,
  ) {
    return this.geoService.autocompleteAddress(text, country, near);
  }

  @Get('validate-postcode')
  @UseGuards(JwtAuthGuard)
  validatePostcode(
    @Query('postcode') postcode: string,
    @Query('country') country?: string,
    @Query('state') state?: string,
  ) {
    return this.geoService.validatePostcode(postcode, country, state);
  }
}
