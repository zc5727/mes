import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateQualityIssueDto, CreateQualityRecordDto, CreateQualityRuleDto, QualityTransitionDto, UpdateQualityDraftDto, UpdateQualityIssueDto } from './dto/quality-record.dto';
import { QualityService } from './quality.service';

@Controller('foundation/quality-records')
@RequireCapability('write')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get() list(@TenantId() tenantId: string) { return { data: this.qualityService.list(tenantId), tenantId }; }
  @Get('rules') listRules(@TenantId() tenantId: string) { return { data: this.qualityService.listRules(tenantId), tenantId }; }
  @Get('issues') listIssues(@TenantId() tenantId: string) { return { data: this.qualityService.listIssues(tenantId), tenantId }; }
  @Post() async create(@TenantId() tenantId: string, @Body() dto: CreateQualityRecordDto) { return { data: await this.qualityService.createReliable(tenantId, dto), tenantId }; }
  @Post('rules') async createRule(@TenantId() tenantId: string, @Body() dto: CreateQualityRuleDto, @Headers('x-user-id') actorId?: string) { return { data: await this.qualityService.createRuleReliable(tenantId, dto, actorId), tenantId }; }
  @Post('issues') async createIssue(@TenantId() tenantId: string, @Body() dto: CreateQualityIssueDto, @Headers('x-user-id') actorId?: string) { return { data: await this.qualityService.createIssueReliable(tenantId, dto, actorId), tenantId }; }
  @Patch('issues/:id') async updateIssue(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateQualityIssueDto, @Headers('x-user-id') actorId?: string) { return { data: await this.qualityService.updateIssueReliable(tenantId, id, dto, actorId), tenantId }; }
  @Patch(':id') async updateDraft(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateQualityDraftDto, @Headers('x-user-id') actorId?: string) { return { data: await this.qualityService.updateDraftReliable(tenantId, id, dto, actorId), tenantId }; }
  @Post(':id/submit') async submit(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: await this.qualityService.submitReliable(tenantId, id, dto), tenantId }; }
  @Post(':id/confirm') async confirm(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: await this.qualityService.confirmReliable(tenantId, id, dto), tenantId }; }
  @Post(':id/reject') async reject(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: await this.qualityService.rejectReliable(tenantId, id, dto), tenantId }; }
}
