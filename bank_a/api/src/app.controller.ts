import { Controller, Get } from '@nestjs/common';

/** Minimal health endpoint — used by Docker healthcheck and load balancers. */
@Controller()
export class AppController {
  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
