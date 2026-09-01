import { IsIn, IsOptional } from 'class-validator';

export type WorkOrderListStatus =
  | 'draft'
  | 'released'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'cancelled';

/** Query contract for the production execution work-order list. */
export class ListWorkOrderQueryDto {
  @IsOptional()
  @IsIn(['draft', 'released', 'in_progress', 'paused', 'completed', 'cancelled'])
  status?: WorkOrderListStatus;
}
