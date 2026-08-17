import { useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/Dialog';
import { Member } from '@/schemas/member';
import { member_status } from 'tmbwa-shared';
import { transitionMemberStatus } from '@/lib/firebase/financial';
import { toast } from '@/hooks/useToast';

export function DialogMemberStatus({ member }: { member: Member }) {
  const [open, setOpen] = useState(false); const [status, setStatus] = useState(member.status); const [saving, setSaving] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="secondary">Change status</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Member lifecycle status</DialogTitle><DialogDescription>Only active members receive new monthly charges and retain sign-in access. Terminal resigned/deceased statuses cannot be reopened.</DialogDescription></DialogHeader><select className="w-full rounded border p-2 capitalize" value={status} onChange={(event) => setStatus(event.target.value as Member['status'])}>{member_status.map((item) => <option key={item} value={item}>{item}</option>)}</select><DialogFooter><Button disabled={saving || status === member.status} onClick={async () => { setSaving(true); try { await transitionMemberStatus({ memberId: member.member_id, status }); toast({ title: 'Status updated', description: `Member is now ${status}.`, variant: 'success' }); setOpen(false); } catch (error) { toast({ title: 'Status update failed', description: (error as Error).message, variant: 'error' }); } finally { setSaving(false); } }}>{saving ? 'Saving…' : 'Apply status'}</Button></DialogFooter></DialogContent></Dialog>;
}
