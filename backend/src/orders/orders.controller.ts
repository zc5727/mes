import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@TenantId() tenantId: string) { return { data: this.ordersService.findAll(tenantId), tenantId }; }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.ordersService.findOne(tenantId, id), tenantId }; }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateOrderDto) { return { data: this.ordersService.create(tenantId, dto), tenantId }; }
}
