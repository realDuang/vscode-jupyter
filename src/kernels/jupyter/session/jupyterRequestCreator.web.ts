// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import WebSocketIsomorphic from 'isomorphic-ws';
import { ClassType } from '../../../platform/ioc/types';
import { traceError } from '../../../platform/logging';
import { KernelSocketWrapper } from '../../common/kernelSocketWrapper';
import { IKernelSocket } from '../../types';
import { IJupyterRequestCreator } from '../types';

const JupyterWebSockets = new Map<string, WebSocketIsomorphic & IKernelSocket>(); // NOSONAR

// Function for creating node Request object that prevents jupyterlab services from writing its own
// authorization header.
/* eslint-disable @typescript-eslint/no-explicit-any */
@injectable()
export class JupyterRequestCreator implements IJupyterRequestCreator {
    public getRequestCtor(cookieString?: string, allowUnauthorized?: boolean, getAuthHeaders?: () => any) {
        class AuthorizingRequest extends Request {
            constructor(input: RequestInfo, init?: RequestInit) {
                super(input, init);

                // Add all of the authorization parts onto the headers.
                const origHeaders = this.headers;

                if (getAuthHeaders) {
                    const authorizationHeader = getAuthHeaders();
                    const keys = Object.keys(authorizationHeader);
                    keys.forEach((k) => origHeaders.append(k, authorizationHeader[k].toString()));
                    origHeaders.set('Content-Type', 'application/json');

                    // Rewrite the 'append' method for the headers to disallow 'authorization' after this point
                    const origAppend = origHeaders.append.bind(origHeaders);
                    origHeaders.append = (k, v) => {
                        if (k.toLowerCase() !== 'authorization') {
                            origAppend(k, v);
                        }
                    };
                }

                // Append the other settings we might need too
                if (allowUnauthorized) {
                    // rejectUnauthorized not allowed in web so we can't do anything here.
                }

                if (cookieString) {
                    this.headers.append('Cookie', cookieString);
                }
            }
        }

        return AuthorizingRequest;
    }

    public getWebsocketCtor(_cookieString?: string, _allowUnauthorized?: boolean, _getAuthHeaders?: () => any) {
        class JupyterWebSocket extends KernelSocketWrapper(WebSocketIsomorphic) {
            private kernelId: string | undefined;
            private timer: NodeJS.Timeout | number = 0;
            private boundOpenHandler = this.openHandler.bind(this);

            constructor(url: string) {
                super(url, [
                    'synapse',
                    'MwcToken%20eyJhbGciOiJSUzI1NiIsImtpZCI6IjNGNEU0M0M3NUQ0OTRFQzBGODFDQTJEOERFNUZFQkI1NTcyOEQyRDIiLCJ4NXQiOiJQMDVEeDExSlRzRDRIS0xZM2xfcnRWY28wdEkiLCJ0eXAiOiJKV1QifQ.eyJvcmlnaW5hbEF1dGhvcml6YXRpb25IZWFkZXIiOiJCZWFyZXIgZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKU1V6STFOaUlzSW5nMWRDSTZJalJUWm5aelluUjRNbXRWY0dOSExYTllUR05RUjNGcFZVTnhXU0lzSW10cFpDSTZJalJUWm5aelluUjRNbXRWY0dOSExYTllUR05RUjNGcFZVTnhXU0o5LmV5SmhkV1FpT2lKb2RIUndjem92TDJGdVlXeDVjMmx6TG5kcGJtUnZkM010YVc1MExtNWxkQzl3YjNkbGNtSnBMMkZ3YVNJc0ltbHpjeUk2SW1oMGRIQnpPaTh2YzNSekxuZHBibVJ2ZDNNdGNIQmxMbTVsZEM5bFpEYzBOemN3TlMwME4ySmxMVFJsWVRRdE9HRm1OUzA1TmpObE5XUTRNVE01Tm1Jdklpd2lhV0YwSWpveE5qY3pNak15T0RVeExDSnVZbVlpT2pFMk56TXlNekk0TlRFc0ltVjRjQ0k2TVRZM016SXpOekUxTnl3aVlXTmpkQ0k2TUN3aVlXTnlJam9pTVNJc0ltRnBieUk2SWtGVVVVRjVMemhYUVVGQlFVcHJXRzFwYlVGVGFHOVFhWGRoWkN0eWMyWXZXbEJ1YzFkc2JrMHJUMEp0U1ZrclV6azRZa2dyUWxoNFMyazBSREo1U0VSaWNGcHpSVE0xY0dGc1ZWUWlMQ0poYlhJaU9sc2ljSGRrSWwwc0ltRndjR2xrSWpvaU5EUTRaVGcwTkRZdE4yWXlaQzAwWXpRNUxUa3lOMlV0WlRoaE5tTmpPV1JqWVdNeUlpd2lZWEJ3YVdSaFkzSWlPaUl3SWl3aVptRnRhV3g1WDI1aGJXVWlPaUp1WW5NaUxDSm5hWFpsYmw5dVlXMWxJam9pYldkeUlpd2lhWEJoWkdSeUlqb2lNUzR5TURNdU1URXhMakV3TmlJc0ltNWhiV1VpT2lKdFlXNWhaMlZ5SWl3aWIybGtJam9pTVdNd016UmxPR1F0TlRabU5pMDBZVGhtTFRoa01EVXRNekEzTlRoaE56QTBaVFEzSWl3aWNIVnBaQ0k2SWpFd01ETkVSa1pFTURBNVJEbEVSRVlpTENKeWFDSTZJakF1UVVGQlFVSllaREEzWWpWSWNFVTJTemxhV1MxWVdVVTFZWGRyUVVGQlFVRkJRVUZCZDBGQlFVRkJRVUZCUVVGQ1FVZFZMaUlzSW5OamNDSTZJblZ6WlhKZmFXMXdaWEp6YjI1aGRHbHZiaUlzSW5OMVlpSTZJbUZoVUZsTU9VbzFVSGRHTkUwelVtTkZNV2M1ZFRaT1ZHbFZVRWRrUmxKdVZqTTVVMk5wVkdaS1JYTWlMQ0owYVdRaU9pSmxaRGMwTnpjd05TMDBOMkpsTFRSbFlUUXRPR0ZtTlMwNU5qTmxOV1E0TVRNNU5tSWlMQ0oxYm1seGRXVmZibUZ0WlNJNkltMW5ja0J1WW5kc0xtTmpjMk4wY0M1dVpYUWlMQ0oxY0c0aU9pSnRaM0pBYm1KM2JDNWpZM05qZEhBdWJtVjBJaXdpZFhScElqb2llVGRmY1c0emFsRjBhMjF6YVVOWFRXWlhNRzVCUVNJc0luWmxjaUk2SWpFdU1DSXNJbmRwWkhNaU9sc2lZamM1Wm1KbU5HUXRNMlZtT1MwME5qZzVMVGd4TkRNdE56WmlNVGswWlRnMU5UQTVJbDE5Lk5DM1kzNURoRVduaXV4QUU1aGNBeEVoSHNKemU0akxERjF5eFZ5SmlZRTNmaDdKVjRrb3Z2TzEyTjVjVnp0SHVrcmR2RHJBY280REZpS1prdHVMRUw1RkEzeVp1YjJGOFBGbTVEekxuNVA5cTJTOFZEUk8yQUROTVlKU2xlSFlVZWhKcWNNNG5nSUpQTnhkU3NNN1UwaHRuSVVacnltTjJYSy1NZm1La3J5djZ3enBqUEUtVk80Vkg1MklPNm9RbU5PcGhYNzhOaG1KcGRXdmpiY1RSLTRIak9KNWYyN3lIaU45dm56cDk5YWxrRkF3dC1sVGQwLThMZ1VreW1ZS2RqWWhHQ3ZNbVhNZ3R3WGttWnJJVnc2VGMtc0lZMVdndHVxajhDVjF4NTBqbzdaeG5XTlpNbUVQRWxjcDZid09ZYUJlRXpHOVJ1cENRcXBNMWVlMWFiZyIsInJvbGxvdXRGcWRuIjoiZWRvZy5wYmlkZWRpY2F0ZWQud2luZG93cy1pbnQubmV0IiwidmlydHVhbFNlcnZpY2VPYmplY3RJZCI6IkUwN0E0OTA5LURGMjItNEYxMS1CQkVFLTFGNkYzQjlFQ0UzOSIsIndvcmtsb2FkQ2xhaW1zIjoie1xyXG4gIFwid29ya2xvYWRUeXBlXCI6IFwiTm90ZWJvb2tcIixcclxuICBcIndvcmtzcGFjZU9iamVjdElkXCI6IFwiY2ZkYjk2MDItMTg3ZC00NWMwLTkxOGUtMjcxOWY0ZWJiYmYzXCIsXHJcbiAgXCJ0ZW5hbnRJZFwiOiBcImVkNzQ3NzA1LTQ3YmUtNGVhNC04YWY1LTk2M2U1ZDgxMzk2YlwiLFxyXG4gIFwidXNlck9iamVjdElkXCI6IFwiMWMwMzRlOGQtNTZmNi00YThmLThkMDUtMzA3NThhNzA0ZTQ3XCIsXHJcbiAgXCJ1c2VyUHJpbmNpcGFsTmFtZVwiOiBcIm1nckBuYndsLmNjc2N0cC5uZXRcIixcclxuICBcImFydGlmYWN0c1wiOiBbXHJcbiAgICB7XHJcbiAgICAgIFwiYXJ0aWZhY3RPYmplY3RJZFwiOiBcIjQwODZhZTQwLWM2NmItNGE3Ni1iZTY5LTA3MzFjZWQxZjA2MVwiLFxyXG4gICAgICBcInBlcm1pc3Npb25zXCI6IDE4NzkwNDgyNzEsXHJcbiAgICAgIFwiZXh0ZW5kZWRQcm9wZXJ0aWVzXCI6IHt9XHJcbiAgICB9XHJcbiAgXSxcclxuICBcIndvcmtzcGFjZVBlcm1pc3Npb25zXCI6IDE1XHJcbn0iLCJ0b2tlblR5cGUiOiJNd2NUb2tlbiIsImN1c3RvbWVyQ2FwYWNpdHlPYmplY3RJZCI6IkUzREI1MDExLTZDQjEtNEIyNS1CMzE4LTIwN0NGQjUwNDMxNCIsImV4cCI6MTY3MzIzNjc2NCwiaXNzIjoiZWRvZy5wYmlkZWRpY2F0ZWQud2luZG93cy1pbnQubmV0IiwibmJmIjoxNjczMjMyODUxLCJpYXQiOjE2NzMyMzMxNjR9.Pg60adUD-6xVTIHxkNml0GVqM8c_qcY6_Tcjg5Gb9lXJ08dCbtJiyrUpCZjlpxAGVEStRkI6zZMYCmwWLeJtMiQGAWbzIHS0J0dW2CNcorxCKosgAvAlxniiVQ0WtQrDq2yZz6d8KRbfQH9SHLMqmD_d9W9v1XoCy62f6oyp5N04CZsVt2LbVFshrYrAdkNJyVHDxKMFAY6D2M1wugpz7FkNic2hDCDyS5MiO1xnSF_L8YGxrqj3onwJmzqty5bKdWyHUtGe5uH5hDOR_RSaNHTBcxMxUgVjvwwWRflhqOZT-A5hzT84ruRtYG0KGV97YnX8L54Dw9C9RCfGMJWA8Q'
                ]);
                let timer: NodeJS.Timeout | undefined = undefined;
                // Parse the url for the kernel id
                const parsed = /.*\/kernels\/(.*)\/.*/.exec(url);
                if (parsed && parsed.length > 1) {
                    this.kernelId = parsed[1];
                }
                if (this.kernelId) {
                    JupyterWebSockets.set(this.kernelId, this);
                    this.onclose = () => {
                        if (timer && this.timer !== timer) {
                            clearInterval(timer as any);
                        }
                        if (JupyterWebSockets.get(this.kernelId!) === this) {
                            JupyterWebSockets.delete(this.kernelId!);
                        }
                    };
                } else {
                    traceError('KernelId not extracted from Kernel WebSocket URL');
                }

                // TODO: Implement ping. Well actually see if ping is necessary
                // Ping the websocket connection every 30 seconds to make sure it stays alive
                //timer = this.timer = setInterval(() => this.ping(), 30_000);

                // On open, replace the onmessage handler with our own.
                this.addEventListener('open', this.boundOpenHandler);
            }

            private openHandler() {
                // Node version uses emit override to handle messages before they go to jupyter (and pause messages)
                // We need a workaround. There is no 'emit' on websockets for the web so we have to create one.
                const originalMessageHandler = this.onmessage;

                // We do this by replacing the set onmessage (set by jupyterlabs) with our
                // own version
                this.onmessage = (ev) => {
                    this.handleEvent(
                        (ev, ...args) => {
                            const event: WebSocketIsomorphic.MessageEvent = {
                                data: args[0],
                                type: ev.toString(),
                                target: this
                            };
                            originalMessageHandler(event);
                            return true;
                        },
                        'message',
                        ev.data
                    );
                };

                this.removeEventListener('open', this.boundOpenHandler);
            }
        }
        return JupyterWebSocket as any;
    }

    public getWebsocket(id: string): IKernelSocket | undefined {
        return JupyterWebSockets.get(id);
    }

    public getFetchMethod(): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
        return fetch;
    }

    public getHeadersCtor(): ClassType<Headers> {
        return Headers;
    }

    public getRequestInit(): RequestInit {
        return { cache: 'no-store' };
    }
}
