import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateLocationDto, CreateMaterialDto, ListInventoryQuery, MaterialIssueDto, StockCountDto, StockReceiptDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@RequireCapability('write')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  private factoryId(query?: string): string { return query?.trim() || 'factory-demo'; }
  @Get('materials') materials(@TenantId() tenantId: string, @Query('factoryId') factoryId?: string) { return { data: this.service.listMaterials(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('materials') async createMaterial(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: CreateMaterialDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createMaterialReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
  @Get('locations') locations(@TenantId() tenantId: string, @Query('factoryId') factoryId?: string) { return { data: this.service.listLocations(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('locations') async createLocation(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: CreateLocationDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createLocationReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
  @Get('balances') balances(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Query() query: ListInventoryQuery) { return { data: this.service.listBalances(tenantId, this.factoryId(factoryId), query), tenantId }; }
  @Get('ledger') ledger(@TenantId() tenantId: string, @Query('factoryId') factoryId: string) { return { data: this.service.listLedger(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('receipts') async receipt(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: StockReceiptDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.receiptReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
  @Post('issues') async issue(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: MaterialIssueDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.issueReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
  @Post('returns') async returnMaterial(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: MaterialIssueDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.returnMaterialReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
  @Post('counts') async count(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: StockCountDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.countReliable(tenantId, this.factoryId(factoryId), dto, actorId), tenantId }; }
}
