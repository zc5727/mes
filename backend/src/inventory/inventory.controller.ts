import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateLocationDto, CreateMaterialDto, ListInventoryQuery, MaterialIssueDto, StockCountDto, StockReceiptDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  private factoryId(query?: string): string { return query?.trim() || 'factory-demo'; }
  @Get('materials') materials(@TenantId() tenantId: string, @Query('factoryId') factoryId?: string) { return { data: this.service.listMaterials(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('materials') createMaterial(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: CreateMaterialDto) { return { data: this.service.createMaterial(tenantId, this.factoryId(factoryId), dto), tenantId }; }
  @Get('locations') locations(@TenantId() tenantId: string, @Query('factoryId') factoryId?: string) { return { data: this.service.listLocations(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('locations') createLocation(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: CreateLocationDto) { return { data: this.service.createLocation(tenantId, this.factoryId(factoryId), dto), tenantId }; }
  @Get('balances') balances(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Query() query: ListInventoryQuery) { return { data: this.service.listBalances(tenantId, this.factoryId(factoryId), query), tenantId }; }
  @Get('ledger') ledger(@TenantId() tenantId: string, @Query('factoryId') factoryId: string) { return { data: this.service.listLedger(tenantId, this.factoryId(factoryId)), tenantId }; }
  @Post('receipts') receipt(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: StockReceiptDto) { return { data: this.service.receipt(tenantId, this.factoryId(factoryId), dto), tenantId }; }
  @Post('issues') issue(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: MaterialIssueDto) { return { data: this.service.issue(tenantId, this.factoryId(factoryId), dto), tenantId }; }
  @Post('returns') returnMaterial(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: MaterialIssueDto) { return { data: this.service.returnMaterial(tenantId, this.factoryId(factoryId), dto), tenantId }; }
  @Post('counts') count(@TenantId() tenantId: string, @Query('factoryId') factoryId: string, @Body() dto: StockCountDto) { return { data: this.service.count(tenantId, this.factoryId(factoryId), dto), tenantId }; }
}
