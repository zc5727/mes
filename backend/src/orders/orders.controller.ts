import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@RequireCapability('write')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@TenantId() tenantId: string) { return { data: this.ordersService.findAll(tenantId), tenantId }; }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.ordersService.findOne(tenantId, id), tenantId }; }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: this.ordersService.create(tenantId, dto, userId), tenantId };
  }
}
