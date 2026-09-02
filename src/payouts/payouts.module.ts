import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CommissionRecord,
  CommissionRecordSchema,
} from './entities/commission-record.entity';
import {
  WithdrawalRequest,
  WithdrawalRequestSchema,
} from './entities/withdrawal-request.entity';
import {
  WebsiteWallet,
  WebsiteWalletSchema,
} from './entities/website-wallet.entity';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from './entities/wallet-transaction.entity';
import {
  BankDetails,
  BankDetailsSchema,
} from './entities/bank-details.entity';
import {
  ApprovalHistory,
  ApprovalHistorySchema,
} from './entities/approval-history.entity';
import {
  TransactionHistory,
  TransactionHistorySchema,
} from './entities/transaction-history.entity';
import {
  WiseWebhookEvent,
  WiseWebhookEventSchema,
} from './entities/wise-webhook-event.entity';
import {
  StripeWiseDestination,
  StripeWiseDestinationSchema,
} from './entities/stripe-wise-destination.entity';
import {
  StripeWisePayout,
  StripeWisePayoutSchema,
} from './entities/stripe-wise-payout.entity';
import {
  StripePaymentsToFa,
  StripePaymentsToFaSchema,
} from './entities/stripe-payments-to-fa.entity';
import {
  OrderCommissionTransfer,
  OrderCommissionTransferSchema,
} from './entities/order-commission-transfer.entity';
import { Order, OrderSchema } from '../orders/entities/order.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { CommissionsService } from './services/commissions.service';
import { WithdrawalsService } from './services/withdrawals.service';
import { WalletsService } from './services/wallets.service';
import { BankDetailsService } from './services/bank-details.service';
import { AuditService } from './services/audit.service';
import { CommissionSchedulerService } from './services/commission-scheduler.service';
import { CommissionsController } from './controllers/commissions.controller';
import { WithdrawalsController } from './controllers/withdrawals.controller';
import { BankDetailsController } from './controllers/bank-details.controller';
import { WalletsController } from './controllers/wallets.controller';
import { AdminTransactionsController } from './controllers/admin-transactions.controller';
import { WiseWebhookController } from './controllers/wise-webhook.controller';
import { StripeWisePayoutsController } from './controllers/stripe-wise-payouts.controller';
import { StripeWisePayoutWebhookController } from './controllers/stripe-wise-payout-webhook.controller';
import { OrderCommissionTransfersController } from './controllers/order-commission-transfers.controller';
import { AdminTransactionsService } from './services/admin-transactions.service';
import { WiseService } from './services/wise.service';
import { StripeAccountService } from './services/stripe-account.service';
import { StripeMoneyManagementService } from './services/stripe-money-management.service';
import { StripeWisePayoutsService } from './services/stripe-wise-payouts.service';
import { StripePaymentBreakdownService } from './services/stripe-payment-breakdown.service';
import { OrderCommissionTransferService } from './services/order-commission-transfer.service';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CommissionRecord.name, schema: CommissionRecordSchema },
      { name: WithdrawalRequest.name, schema: WithdrawalRequestSchema },
      { name: WebsiteWallet.name, schema: WebsiteWalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: BankDetails.name, schema: BankDetailsSchema },
      { name: ApprovalHistory.name, schema: ApprovalHistorySchema },
      { name: TransactionHistory.name, schema: TransactionHistorySchema },
      { name: WiseWebhookEvent.name, schema: WiseWebhookEventSchema },
      { name: StripeWiseDestination.name, schema: StripeWiseDestinationSchema },
      { name: StripeWisePayout.name, schema: StripeWisePayoutSchema },
      { name: StripePaymentsToFa.name, schema: StripePaymentsToFaSchema },
      { name: OrderCommissionTransfer.name, schema: OrderCommissionTransferSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
    NotificationsModule,
    MailModule,
  ],
  controllers: [
    CommissionsController,
    WithdrawalsController,
    BankDetailsController,
    WalletsController,
    AdminTransactionsController,
    WiseWebhookController,
    StripeWisePayoutsController,
    StripeWisePayoutWebhookController,
    OrderCommissionTransfersController,
  ],
  providers: [
    CommissionsService,
    WithdrawalsService,
    WalletsService,
    BankDetailsService,
    AuditService,
    CommissionSchedulerService,
    AdminTransactionsService,
    WiseService,
    StripeAccountService,
    StripeMoneyManagementService,
    StripeWisePayoutsService,
    StripePaymentBreakdownService,
    OrderCommissionTransferService,
  ],
  exports: [CommissionsService, WithdrawalsService, OrderCommissionTransferService],
})
export class PayoutsModule {}
