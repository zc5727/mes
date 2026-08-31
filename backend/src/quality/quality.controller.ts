import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
  @Post() create(@TenantId() tenantId: string, @Body() dto: CreateQualityRecordDto) { return { data: this.qualityService.create(tenantId, dto), tenantId }; }
  @Post('rules') createRule(@TenantId() tenantId: string, @Body() dto: CreateQualityRuleDto) { return { data: this.qualityService.createRule(tenantId, dto), tenantId }; }
  @Post('issues') createIssue(@TenantId() tenantId: string, @Body() dto: CreateQualityIssueDto) { return { data: this.qualityService.createIssue(tenantId, dto), tenantId }; }
  @Patch('issues/:id') updateIssue(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateQualityIssueDto) { return { data: this.qualityService.updateIssue(tenantId, id, dto), tenantId }; }
  @Patch(':id') updateDraft(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateQualityDraftDto) { return { data: this.qualityService.updateDraft(tenantId, id, dto), tenantId }; }
  @Post(':id/submit') submit(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: this.qualityService.submit(tenantId, id, dto), tenantId }; }
  @Post(':id/confirm') confirm(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: this.qualityService.confirm(tenantId, id, dto), tenantId }; }
  @Post(':id/reject') reject(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: QualityTransitionDto) { return { data: this.qualityService.reject(tenantId, id, dto), tenantId }; }
}
