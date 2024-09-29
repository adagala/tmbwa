import React, { useEffect } from "react";
import {
  RiArrowRightSLine,
  RiGroupLine,
  RiIndeterminateCircleLine,
  RiLoaderLine,
  RiShieldCheckLine,
  RiUserForbidLine,
} from "@remixicon/react";
import { List, ListItem } from "@tremor/react";
import { Member, Role, member_roles } from "@/schemas/member";
import { Input } from "@/components/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/Select";
import { Button } from "@/components/Button";
import { DialogMemberForm } from "@/components/ui/members/DialogMemberForm";
import { getMembers } from "@/lib/firebase/firestore";
import useUser from "@/hooks/useUser";
import debounce from "lodash.debounce";
import { Link } from "react-router-dom";
import { Tooltip } from "@/components/Tooltip";
import { Avatar } from "@/components/Avatar";

export default function MembersPage() {
  const { role } = useUser();
  const [selectedRole, setSelectedRole] = React.useState<Role | "">("");
  const [selectedFeeStatus, setSelectedFeeStatus] = React.useState("");
  const [searchValue, setSearchValue] = React.useState("");
  const [querySearch, setQuerySearch] = React.useState("");
  const [members, setMembers] = React.useState<Member[]>([]);
  const [allMembers, setAllMembers] = React.useState<Member[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const debouncedSearch = React.useCallback(
    debounce((query: string) => setQuerySearch(query), 500),
    []
  );

  useEffect(() => {
    debouncedSearch(searchValue);

    return () => {
      debouncedSearch.cancel();
    };
  }, [searchValue, debouncedSearch]);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = getMembers((fetchedMembers) => {
      if (querySearch.length < 1 && !selectedRole) {
        setMembers(fetchedMembers);
      }
      setAllMembers(fetchedMembers);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (
      querySearch.length < 1 &&
      selectedRole === "" &&
      selectedFeeStatus === ""
    ) {
      setMembers(allMembers);
    } else {
      const filteredMembers = allMembers.filter((member) => {
        const regex = new RegExp(querySearch, "gi");
        const isQueryMatch =
          member.firstname.match(regex) || member.lastname.match(regex);
        const isRoleMatch = !selectedRole ? true : member.role === selectedRole;
        const feeStatus = selectedFeeStatus === "paid" ? true : false;
        const isFeeStatusMatch = !selectedFeeStatus
          ? true
          : (member.isFeesPaid || false) === feeStatus;
        return isQueryMatch && isRoleMatch && isFeeStatusMatch;
      });
      setMembers(filteredMembers);
    }
  }, [querySearch, selectedRole, selectedFeeStatus]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between mt-6 font-bold">
        <div className="flex items-center gap-1 text-xl text-guardsman-red-600">
          <RiGroupLine className="size-6 shrink-0" aria-hidden="true" />
          Members
        </div>
        <div className="">
          {role === "administrator" ? <DialogMemberForm /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="">
          <Input
            placeholder="Search members"
            id="search"
            name="search"
            value={searchValue}
            type="search"
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex flex-col gap-2 sm:flex-row">
            <Select
              name="role"
              value={selectedRole as Role}
              onValueChange={(role: Role) => setSelectedRole(role)}
            >
              <SelectTrigger id="role" name="role" className="capitalize">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {member_roles.map((role) => (
                  <SelectItem key={role} value={role} className="capitalize">
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 flex flex-col gap-2 sm:flex-row">
            <Select
              name="feeStatus"
              value={selectedFeeStatus}
              onValueChange={(feeStatus) => setSelectedFeeStatus(feeStatus)}
            >
              <SelectTrigger
                id="feeStatus"
                name="feeStatus"
                className="capitalize"
              >
                <SelectValue placeholder="Membership fees status" />
              </SelectTrigger>
              <SelectContent>
                {["paid", "unpaid"].map((feeStatus) => (
                  <SelectItem
                    key={feeStatus}
                    value={feeStatus}
                    className="capitalize"
                  >
                    {feeStatus}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="col-span-full flex justify-end gap-2">
          <Button
            className="h-10 whitespace-nowrap"
            variant="secondary"
            onClick={() => {
              setSelectedRole("");
              setSearchValue("");
              setQuerySearch("");
              setSelectedFeeStatus("");
            }}
          >
            Reset filter
          </Button>
        </div>
      </div>
      <div className="">
        {isLoading ? (
          <div className="flex justify-center items-center h-96">
            <div className="flex flex-col items-center space-y-3">
              <RiLoaderLine className="size-6 animate-spin" />
              <div className="font-medium">Loading Members</div>
            </div>
          </div>
        ) : (
          <>
            {members.length > 0 ? (
              <>
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-200 ml-2">
                  {members.length} Member{members.length === 1 ? "" : "s"}
                </div>
                <List className="mt-2">
                  {members.map((member) => (
                    <ListItem
                      key={member.member_id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-900/60 dark:border-gray-800 pl-2"
                    >
                      <Link
                        to={member.member_id}
                        // to="/settings"
                        className="flex justify-between w-full"
                      >
                        <div className="flex min-w-0 gap-x-4">
                          <Avatar
                            initial={`${member.firstname.charAt(0)}${member.lastname.charAt(0)}`}
                          />
                          <div className="min-w-0 flex-auto">
                            <div className="text-sm flex items-center gap-1 font-semibold leading-6 text-gray-900 dark:text-gray-200">
                              {member.firstname} {member.lastname}
                              <Tooltip
                                content={`Membership fees ${!member.isFeesPaid ? "not " : ""} paid`}
                              >
                                {member.isFeesPaid ? (
                                  <RiShieldCheckLine className="size-3.5 text-emerald-500" />
                                ) : (
                                  <RiIndeterminateCircleLine className="size-3.5 text-red-500" />
                                )}
                              </Tooltip>
                            </div>
                            <p className="mt-1 truncate text-xs leading-5 text-gray-500 dark:text-gray-400">
                              {member.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="hidden shrink-0 sm:flex sm:flex-col sm:items-end">
                            <p className="text-xs font-medium leading-6 text-gray-900 dark:text-gray-200 capitalize">
                              {member.role}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-guardsman-red-600 font-bold">
                              WIN: {member.win}
                            </p>
                          </div>
                          <RiArrowRightSLine className="size-6 text-gray-400" />
                        </div>
                      </Link>
                    </ListItem>
                  ))}
                </List>
              </>
            ) : (
              <div className="flex justify-center items-center h-96">
                <div className="flex flex-col items-center space-y-3">
                  <RiUserForbidLine className="size-8" />
                  <div className="font-medium">No Members</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
