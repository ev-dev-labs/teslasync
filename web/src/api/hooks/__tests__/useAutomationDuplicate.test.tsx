import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../../client';
import type { AutomationFull } from '../../types';
import { automationCopyInput, useDuplicateAutomation } from '../useAutomations';
vi.mock('../../client',()=>({request:vi.fn()}));
vi.mock('../_toastHelpers',()=>({useMutationToast:()=>({success:vi.fn(),error:vi.fn()})}));
const source = {
 id:42,name:'Morning charge',description:'Only at home.',vehicle_id:7,enabled:true,token:'never-copy-metadata',
 execution_count:99,
 triggers:[{id:10,automation_id:42,step_id:55,kind:'trigger_schedule',cron_expr:'0 7 * * *',timezone:'UTC'}],
 conditions:[],actions:[{id:11,automation_id:42,kind:'action_command',command_name:'charge_start',command_params:{charging_amps:16}}],
} as unknown as AutomationFull;
beforeEach(()=>vi.clearAllMocks());
describe('disabled automation copies',()=>{
 it('projects only the create contract, strips identity/state, and detaches nested data',()=>{
  const input=automationCopyInput(source,'Morning charge (copy)');
  expect(input).toEqual({name:'Morning charge (copy)',description:'Only at home.',vehicle_id:7,enabled:false,
   triggers:[{kind:'trigger_schedule',cron_expr:'0 7 * * *',timezone:'UTC'}],conditions:[],
   actions:[{kind:'action_command',command_name:'charge_start',command_params:{charging_amps:16}}]});
  expect(JSON.stringify(input)).not.toContain('never-copy-metadata');
  expect(source.enabled).toBe(true);
  expect(input.actions[0]).not.toBe(source.actions[0]);
 });
 it('fetches the full definition then creates a disabled copy through POST /automations',async()=>{
  vi.mocked(request).mockResolvedValueOnce(source).mockResolvedValueOnce({...source,id:99,enabled:false});
  const client=new QueryClient({defaultOptions:{mutations:{retry:false},queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>useDuplicateAutomation(),{wrapper});
  const open=vi.fn();
  await act(async()=>{result.current.mutate(42,{onSuccess:open});});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  expect(request).toHaveBeenNthCalledWith(1,'/automations/42');
  expect(request).toHaveBeenNthCalledWith(2,'/automations',expect.objectContaining({method:'POST',requiresLiveMode:true}));
  const options=vi.mocked(request).mock.calls[1][1];
  expect(JSON.parse(String(options?.body))).toEqual(automationCopyInput(source,'Morning charge (copy)'));
  expect(open.mock.calls[0][0]).toEqual(expect.objectContaining({id:99,enabled:false}));
 });
 it('does not submit a partial copy or open anything if detail loading fails',async()=>{
  vi.mocked(request).mockRejectedValueOnce(new Error('Detail failed'));
  const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>useDuplicateAutomation(),{wrapper});const open=vi.fn();
  await act(async()=>{result.current.mutate(42,{onSuccess:open});});
  await waitFor(()=>expect(result.current.isError).toBe(true));
  expect(request).toHaveBeenCalledTimes(1);expect(open).not.toHaveBeenCalled();
 });
});
