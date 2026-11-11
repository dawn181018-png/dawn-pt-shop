-- 2026-11-11 담당자 검사 장치 바로잡기 — 기존 함수 guard_reservation_trainer()만 다시 만든다. 표·데이터는 바꾸지 않는다.
--
-- 문제: 2026-11-09 담당자 기능 이후 관리자가 만든 예약은 기본값 "대표(나)"로 담당자가 'owner'로 저장되는데, 검사 장치가
--       대리 트레이너의 'owner' 레슨 변경을 모두 막았다. 그래서 대리 지정된 고객(예: 가족 공용 세션)에서
--       - 남은 횟수를 반복 예약이 다 잡고 있을 때 "마지막 회차 취소하고 등록"이 오류로 끝나고(마지막 회차가 대표 담당),
--       - 관리자가 잡아 둔 레슨을 대리 트레이너가 완료·노쇼 처리하는 것도 막혔다.
-- 바뀐 규칙(대리 트레이너 계정만 해당, 관리자 계정은 예전과 같음):
--   - 막는 것: 다른 대리 트레이너가 담당자로 정해진 레슨의 변경·취소·완료·삭제(예전과 같음).
--   - 허용: 담당자가 비어 있거나 대표('owner')인 레슨 — 담당자 기능 이전처럼 지정 고객이면 처리할 수 있다.
--   - 대리 트레이너가 그런 레슨을 완료·노쇼로 처리하면 담당자를 그 트레이너로 기록한다(대리 정산에 정확히 잡히도록).
--     그 밖의 변경(이동·취소 등)에서는 담당자를 바꾸지 않는다. 대리 트레이너가 만든 예약은 예전처럼 본인 담당.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

create or replace function guard_reservation_trainer() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_uid uuid := auth.uid();
  v_own text;
begin
  if v_role = 'delegate' then
    select lower(btrim(delegate_email)) into v_own from lesson_delegations
      where delegate_user_id = v_uid order by created_at desc limit 1;
    if tg_op = 'INSERT' then
      new.trainer_email := v_own; -- 대리가 만든 예약은 항상 본인 담당
      return new;
    end if;
    -- 다른 대리 트레이너 담당 레슨만 막는다(비어 있음·대표 담당은 지정 고객이면 처리 가능)
    if old.trainer_email is not null and old.trainer_email <> 'owner' and old.trainer_email is distinct from v_own then
      raise exception 'not_your_lesson';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.status in ('done', 'noshow') and old.status not in ('done', 'noshow') and v_own is not null then
      new.trainer_email := v_own; -- 대리가 완료·노쇼 처리한 레슨은 그 트레이너 담당으로 기록
    else
      new.trainer_email := old.trainer_email; -- 그 밖에는 대리가 담당자를 바꿀 수 없다
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  -- 관리자(또는 서버): 담당자 값은 비움 / 'owner' / 이 관리자가 지정한 대리 트레이너 이메일만
  if new.trainer_email is not null and new.trainer_email <> 'owner'
     and (tg_op = 'INSERT' or new.trainer_email is distinct from old.trainer_email) then
    new.trainer_email := lower(btrim(new.trainer_email));
    if not exists (select 1 from lesson_delegations d
                   where d.owner_id = new.owner_id and lower(btrim(d.delegate_email)) = new.trainer_email) then
      raise exception '담당자로 고른 트레이너가 대리 지정 목록에 없어요';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function guard_reservation_trainer() from public, anon, authenticated;

notify pgrst, 'reload schema';
