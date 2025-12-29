import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateSupportDto } from './dto/create-support.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) { }

  @Post()
  create(@Body() createSupportDto: CreateSupportDto) {
    return this.supportService.create(createSupportDto);
  }

  @Get()
  findAll() {
    return this.supportService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.supportService.findOne(id);
  }
}
