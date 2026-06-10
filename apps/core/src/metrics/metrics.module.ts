import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsController } from "./metrics.controller";

@Module({
  controllers: [MetricsController],
  providers: [MetricsMiddleware],
  exports: [MetricsMiddleware],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
